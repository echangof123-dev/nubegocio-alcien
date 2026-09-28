-- 0015 · Paridad con Treinta: balance de ingresos y egresos, gastos con fecha y anulación, venta libre,
--        recibo de cada venta (enlace y ticket), clientes con historial y fecha de pago, inventario
--        (valor, stock bajo, movimientos, carga masiva) y fotos de productos.

-- ---------- Gastos ----------

alter table app.gasto add column fecha date;
update app.gasto g set fecha = (g.creado_en at time zone n.zona_horaria)::date from app.negocio n where n.id = g.negocio_id;
alter table app.gasto alter column fecha set not null;
create or replace function app.gasto_fecha_local()
returns trigger
language plpgsql
as $$
begin
  if new.fecha is null then
    new.fecha := (coalesce(new.creado_en, now()) at time zone (select zona_horaria from app.negocio where id = new.negocio_id))::date;
  end if;
  return new;
end $$;
create trigger gasto_fecha_local before insert on app.gasto for each row execute function app.gasto_fecha_local();
alter table app.gasto add column proveedor_id uuid references app.proveedor(id);
alter table app.gasto add column estado text not null default 'vigente' check (estado in ('vigente', 'anulado'));
alter table app.gasto add column anulado_en timestamptz;
alter table app.gasto add column anulado_por uuid references auth.usuario(id);
create index gasto_fecha_idx on app.gasto (negocio_id, fecha desc);

-- p: {categoria, monto, metodo, descripcion, fecha, proveedor_id}
create or replace function app.registrar_gasto_v2(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_neg    uuid := app.negocio_actual();
  v_hoy    date := (now() at time zone (select zona_horaria from app.negocio where id = v_neg))::date;
  v_fecha  date := coalesce(nullif(p->>'fecha', '')::date, v_hoy);
  v_metodo text := coalesce(p->>'metodo', 'efectivo');
  v_monto  numeric := round((p->>'monto')::numeric, 2);
  v_turno  uuid;
  v_id     uuid;
begin
  if coalesce(current_setting('app.rol', true), '') = 'bodeguero' then
    raise exception 'No tienes permiso para registrar gastos' using errcode = '42501';
  end if;
  if coalesce(trim(p->>'categoria'), '') = '' then
    raise exception 'Elige la categoría del gasto' using errcode = '22023';
  end if;
  if v_monto is null or v_monto <= 0 then
    raise exception 'Indica el monto del gasto' using errcode = '22023';
  end if;
  if v_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'otro') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;
  if v_fecha > v_hoy or v_fecha < v_hoy - 366 then
    raise exception 'La fecha del gasto debe ser de este último año' using errcode = '22023';
  end if;
  -- Solo un gasto de hoy en efectivo sale de la caja abierta
  if v_metodo = 'efectivo' and v_fecha = v_hoy then
    v_turno := app.turno_abierto();
  end if;
  insert into app.gasto (negocio_id, turno_id, categoria, descripcion, monto, metodo, fecha, proveedor_id, creado_por)
  values (v_neg, v_turno, trim(p->>'categoria'), nullif(trim(p->>'descripcion'), ''), v_monto, v_metodo, v_fecha,
          nullif(p->>'proveedor_id', '')::uuid, current_setting('app.usuario_id')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.registrar_gasto(p_categoria text, p_monto numeric, p_metodo text, p_descripcion text default null)
returns uuid
language sql
as $$
  select app.registrar_gasto_v2(jsonb_build_object('categoria', p_categoria, 'monto', p_monto, 'metodo', p_metodo, 'descripcion', p_descripcion));
$$;

create or replace function app.anular_gasto(p_gasto uuid)
returns void
language plpgsql
as $$
declare
  g app.gasto%rowtype;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador anulan gastos' using errcode = '42501';
  end if;
  select * into g from app.gasto where id = p_gasto for update;
  if not found or g.estado = 'anulado' then
    raise exception 'Gasto no encontrado' using errcode = 'P0002';
  end if;
  if g.turno_id is not null and g.turno_id is distinct from app.turno_abierto() then
    raise exception 'Ese gasto es de una caja ya cerrada' using errcode = '55000';
  end if;
  -- Sin turno deja de contar en la caja abierta
  update app.gasto set estado = 'anulado', anulado_en = now(), turno_id = null,
    anulado_por = nullif(current_setting('app.usuario_id', true), '')::uuid
  where id = g.id;
end $$;

-- ---------- Venta libre: cobrar un monto con un concepto, sin elegir productos ----------

alter table app.producto drop constraint producto_tipo_check;
alter table app.producto add constraint producto_tipo_check check (tipo in ('venta', 'insumo', 'libre'));

create or replace function app.producto_venta_libre()
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from app.producto where tipo = 'libre' limit 1;
  if v_id is null then
    insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock, tipo)
    values (app.negocio_actual(), 'Venta libre', 'Unidad', null, false, 'libre')
    on conflict (negocio_id, nombre) do update set tipo = 'libre', maneja_stock = false, precio = null, activo = true
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- El concepto de la venta libre se escribe en su línea: solo ese nombre y solo en esa línea
create or replace function app.venta_detalle_solo_concepto()
returns trigger
language plpgsql
as $$
begin
  if new.nombre is distinct from old.nombre
     and not exists (select 1 from app.producto p where p.id = old.producto_id and p.tipo = 'libre') then
    raise exception 'Las líneas de una venta no se modifican' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger venta_detalle_solo_concepto before update of nombre on app.venta_detalle
  for each row execute function app.venta_detalle_solo_concepto();

create or replace function app.registrar_venta_libre(p_monto numeric, p_concepto text, p_pagos jsonb,
  p_cliente uuid default null, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  v_prod uuid := app.producto_venta_libre();
  r record;
begin
  if p_monto is null or round(p_monto, 2) <= 0 then
    raise exception 'Indica el monto' using errcode = '22023';
  end if;
  select * into r from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', v_prod, 'cantidad', 1, 'precio', round(p_monto, 2))),
    p_pagos, p_cliente, p_comprobante, nullif(trim(p_concepto), '')) x;
  update app.venta_detalle set nombre = coalesce(nullif(trim(p_concepto), ''), 'Venta libre')
  where venta_detalle.venta_id = r.venta_id;
  return query select r.venta_id, r.numero, r.total, r.vuelto;
end $$;

-- ---------- Recibo de cada venta (enlace público y ticket para imprimir) ----------

alter table app.venta add column token_publico text;
update app.venta set token_publico = encode(gen_random_bytes(18), 'hex') where token_publico is null;
alter table app.venta alter column token_publico set default encode(gen_random_bytes(18), 'hex');
alter table app.venta alter column token_publico set not null;
create unique index venta_token_uq on app.venta (token_publico);

-- Datos que salen en el recibo (si el negocio no tiene facturación, no hay dirección del SRI)
alter table app.negocio_config add column mensaje_recibo text check (mensaje_recibo is null or length(mensaje_recibo) <= 200);
alter table app.negocio_config add column direccion text check (direccion is null or length(direccion) <= 300);
alter table app.negocio_config add column telefono text check (telefono is null or length(telefono) <= 30);

create or replace function app.recibo_publico(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'negocio', coalesce(s.nombre_comercial, n.nombre), 'ruc', coalesce(s.ruc, n.ruc),
    'direccion', coalesce(cfg.direccion, s.dir_establecimiento), 'telefono', cfg.telefono,
    'mensaje', cfg.mensaje_recibo, 'zona', n.zona_horaria,
    'numero', v.numero, 'fecha', v.creado_en, 'estado', v.estado, 'total', v.total, 'iva', v.iva, 'descuento', v.descuento,
    'subtotal', v.subtotal_0 + v.subtotal_gravado,
    'cliente', cl.nombre, 'cliente_identificacion', cl.identificacion,
    'lineas', (select jsonb_agg(jsonb_build_object('nombre', d.nombre, 'cantidad', d.cantidad, 'precio', d.precio_unitario,
                                                   'descuento', d.descuento, 'total', d.total) order by d.id)
               from app.venta_detalle d where d.venta_id = v.id),
    'pagos', (select jsonb_agg(jsonb_build_object('metodo', pg.metodo, 'monto', pg.monto, 'recibido', pg.recibido, 'vuelto', pg.vuelto) order by pg.id)
              from app.pago pg where pg.venta_id = v.id),
    'factura', (select jsonb_build_object('numero', c.numero, 'estado', c.estado, 'token', c.token_publico)
                from app.comprobante c where c.venta_id = v.id and c.tipo = 'factura' order by c.creado_en desc limit 1))
  from app.venta v join app.negocio n on n.id = v.negocio_id
  left join app.negocio_config cfg on cfg.negocio_id = n.id
  left join app.sri_config s on s.negocio_id = n.id
  left join app.cliente cl on cl.id = v.cliente_id
  where v.token_publico = p_token and length(p_token) = 36;
$$;
revoke all on function app.recibo_publico(text) from public;

-- ---------- Clientes: notas y fecha acordada de pago ----------


alter table app.cliente add column fecha_pago date;

-- ---------- Fotos de productos ----------

create table app.producto_foto (
  producto_id    uuid primary key references app.producto(id) on delete cascade,
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  tipo           text not null check (tipo in ('image/jpeg', 'image/webp', 'image/png')),
  datos          bytea not null check (octet_length(datos) <= 400000),
  actualizado_en timestamptz not null default now()
);
alter table app.producto add column foto_version integer;     -- null = sin foto; cambia con cada foto nueva

create or replace function app.foto_publica(p_producto uuid)
returns table (tipo text, datos bytea)
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select f.tipo, f.datos from app.producto_foto f join app.producto p on p.id = f.producto_id
  where f.producto_id = p_producto and p.activo;
$$;
revoke all on function app.foto_publica(uuid) from public;

-- ---------- Carga masiva de productos (Excel) ----------

-- p_filas: [{nombre, categoria, unidad, precio, costo, stock, stock_minimo, codigo_barras}]
-- Por nombre: si existe se actualiza (el stock se ajusta al valor de la fila), si no se crea.
create or replace function app.importar_productos(p_filas jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_neg   uuid := app.negocio_actual();
  f       jsonb;
  i       integer := 0;
  v_cat   uuid;
  v_prod  app.producto%rowtype;
  v_id    uuid;
  v_stock numeric;
  v_nuevos integer := 0;
  v_act    integer := 0;
  v_errores jsonb := '[]';
  v_nombre text;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador cargan productos' using errcode = '42501';
  end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'El archivo no tiene productos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_filas) > 3000 then
    raise exception 'Carga hasta 3000 productos por archivo' using errcode = '22023';
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    i := i + 1;
    v_nombre := left(trim(coalesce(f->>'nombre', '')), 80);
    begin
      if v_nombre = '' then
        raise exception 'falta el nombre' using errcode = '22023';
      end if;
      v_cat := null;
      if coalesce(trim(f->>'categoria'), '') <> '' then
        select id into v_cat from app.categoria where catalogo.normalizar(nombre) = catalogo.normalizar(trim(f->>'categoria'));
        if v_cat is null then
          insert into app.categoria (negocio_id, nombre) values (v_neg, left(trim(f->>'categoria'), 60)) returning id into v_cat;
        end if;
      end if;
      select * into v_prod from app.producto where catalogo.normalizar(nombre) = catalogo.normalizar(v_nombre) and tipo <> 'libre' limit 1;
      if not found then
        insert into app.producto (negocio_id, nombre, categoria_id, unidad, precio, costo, codigo_barras, stock_minimo)
        values (v_neg, v_nombre, v_cat, coalesce(nullif(trim(f->>'unidad'), ''), 'Unidad'),
                round(nullif(f->>'precio', '')::numeric, 2), round(nullif(f->>'costo', '')::numeric, 4),
                nullif(trim(f->>'codigo_barras'), ''), nullif(f->>'stock_minimo', '')::numeric)
        returning id into v_id;
        v_nuevos := v_nuevos + 1;
        v_stock := nullif(f->>'stock', '')::numeric;
        if v_stock is not null and v_stock > 0 then
          perform app.mover_stock(v_id, 'inicial', v_stock, null, 'Carga desde Excel', round(nullif(f->>'costo', '')::numeric, 4));
        end if;
      else
        update app.producto set
          categoria_id = coalesce(v_cat, categoria_id),
          unidad = coalesce(nullif(trim(f->>'unidad'), ''), unidad),
          precio = coalesce(round(nullif(f->>'precio', '')::numeric, 2), precio),
          costo = coalesce(round(nullif(f->>'costo', '')::numeric, 4), costo),
          codigo_barras = coalesce(nullif(trim(f->>'codigo_barras'), ''), codigo_barras),
          stock_minimo = coalesce(nullif(f->>'stock_minimo', '')::numeric, stock_minimo),
          activo = true
        where id = v_prod.id;
        v_act := v_act + 1;
        v_stock := nullif(f->>'stock', '')::numeric;
        if v_stock is not null and v_prod.maneja_stock and v_stock <> v_prod.stock then
          perform app.mover_stock(v_prod.id, 'ajuste', v_stock - v_prod.stock, null, 'Carga desde Excel');
        end if;
      end if;
    exception
      when invalid_parameter_value or invalid_text_representation or numeric_value_out_of_range
           or check_violation or unique_violation then
        v_errores := v_errores || jsonb_build_object('fila', i, 'nombre', v_nombre, 'error',
          case when sqlstate = '23505' then 'código de barras repetido'
               when sqlstate in ('22P02', '22003') then 'un número no es válido'
               when sqlstate = '23514' then 'un valor no es válido'
               else sqlerrm end);
    end;
  end loop;
  return jsonb_build_object('nuevos', v_nuevos, 'actualizados', v_act, 'errores', v_errores);
end $$;

-- ---------- Balance: ingresos y egresos del periodo ----------

-- Ingresos = lo cobrado de verdad (pagos de ventas que no son fiado + abonos de fiado).
-- Egresos = gastos + pagos a proveedores (sin los anticipos descontados, que ya salieron antes) + anticipos.
create or replace function app.balance_periodo(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
as $$
declare
  v_zona text := (select zona_horaria from app.negocio where id = app.negocio_actual());
  v_ini timestamptz := p_desde::timestamp at time zone v_zona;
  v_fin timestamptz := (p_hasta + 1)::timestamp at time zone v_zona;
  r jsonb;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'Revisa las fechas' using errcode = '22023';
  end if;
  with mov as (
    select 'venta' as tipo, v.id::text as id, v.creado_en as fecha, 'Venta N.º ' || v.numero as concepto,
           coalesce((select string_agg(d.nombre, ', ' order by d.id) from app.venta_detalle d where d.venta_id = v.id), '') as detalle,
           (select coalesce(sum(pg.monto), 0) from app.pago pg where pg.venta_id = v.id and pg.metodo <> 'fiado') as monto,
           (select coalesce(sum(pg.monto), 0) from app.pago pg where pg.venta_id = v.id and pg.metodo = 'fiado') as fiado,
           (select string_agg(distinct pg.metodo, '+') from app.pago pg where pg.venta_id = v.id) as metodo,
           v.token_publico as token, v.numero
    from app.venta v where v.estado <> 'anulada' and v.creado_en >= v_ini and v.creado_en < v_fin
    union all
    select 'abono', f.id::text, f.creado_en, 'Abono de ' || c.nombre, '', f.monto, 0, f.metodo, null, null
    from app.fiado_movimiento f join app.cliente c on c.id = f.cliente_id
    where f.tipo = 'abono' and f.creado_en >= v_ini and f.creado_en < v_fin
    union all
    select 'gasto', g.id::text,
           case when (g.creado_en at time zone v_zona)::date = g.fecha then g.creado_en else (g.fecha + time '12:00') at time zone v_zona end,
           g.categoria, coalesce(g.descripcion, ''), -g.monto, 0, g.metodo, null, null
    from app.gasto g where g.estado = 'vigente' and g.fecha between p_desde and p_hasta
    union all
    select 'compra', pc.id::text, pc.creado_en, 'Pago a ' || coalesce(pr.nombre, 'proveedor') || ' (compra N.º ' || c.numero || ')', '',
           -pc.monto, 0, pc.metodo, null, null
    from app.pago_compra pc join app.compra c on c.id = pc.compra_id left join app.proveedor pr on pr.id = c.proveedor_id
    where pc.metodo <> 'anticipo' and c.estado <> 'anulada' and pc.creado_en >= v_ini and pc.creado_en < v_fin
    union all
    select 'anticipo', a.id::text, a.creado_en, 'Anticipo a ' || pr.nombre, coalesce(a.nota, ''), -a.monto, 0, a.metodo, null, null
    from app.anticipo a join app.proveedor pr on pr.id = a.proveedor_id
    where a.estado = 'vigente' and a.creado_en >= v_ini and a.creado_en < v_fin
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'ingresos', coalesce((select sum(monto) from mov where monto > 0), 0),
    'egresos', coalesce((select -sum(monto) from mov where monto < 0), 0),
    'fiado', coalesce((select sum(fiado) from mov), 0),
    'ventas', (select count(*) from mov where tipo = 'venta'),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'id', id, 'fecha', fecha, 'concepto', concepto,
                              'detalle', detalle, 'monto', monto, 'fiado', fiado, 'metodo', metodo, 'token', token, 'numero', numero)
                              order by fecha desc)
                             from (select * from mov order by fecha desc limit 400) x), '[]')
  ) into r;
  return r;
end $$;

create or replace function app.reporte_periodo(p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
as $$
declare
  v_zona text := (select zona_horaria from app.negocio where id = app.negocio_actual());
  v_ini  timestamptz;
  v_fin  timestamptz;
  v_dias integer;
  r jsonb;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'Revisa las fechas' using errcode = '22023';
  end if;
  if p_hasta - p_desde > 400 then
    raise exception 'Elige un periodo de hasta un año' using errcode = '22023';
  end if;
  v_ini := p_desde::timestamp at time zone v_zona;
  v_fin := (p_hasta + 1)::timestamp at time zone v_zona;
  v_dias := p_hasta - p_desde + 1;

  with v as (
    select * from app.venta where creado_en >= v_ini and creado_en < v_fin and estado <> 'anulada'
  ), d as (
    select vd.*, v.vendedor_id, (v.creado_en at time zone v_zona)::date as dia
    from app.venta_detalle vd join v on v.id = vd.venta_id
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'ventas', (select count(*) from v),
    'total', (select coalesce(sum(total), 0) from v),
    'base', (select coalesce(sum(subtotal_0 + subtotal_gravado), 0) from v),
    'iva', (select coalesce(sum(iva), 0) from v),
    'descuentos', (select coalesce(sum(descuento), 0) from v),
    'costo', (select coalesce(round(sum(cantidad * costo_unitario), 2), 0) from d where costo_unitario is not null),
    'sin_costo', (select coalesce(sum(base), 0) from d where costo_unitario is null),
    'ticket_promedio', (select coalesce(round(avg(total), 2), 0) from v),
    'anuladas', (select count(*) from app.venta where creado_en >= v_ini and creado_en < v_fin and estado = 'anulada'),
    'total_anterior', (select coalesce(sum(total), 0) from app.venta
                       where estado <> 'anulada' and creado_en >= v_ini - make_interval(days => v_dias) and creado_en < v_ini),
    'por_dia', (select coalesce(jsonb_agg(jsonb_build_object('dia', g.dia, 'total', coalesce(t.total, 0), 'ventas', coalesce(t.n, 0)) order by g.dia), '[]')
                from generate_series(p_desde, p_hasta, interval '1 day') as g0(x)
                cross join lateral (select g0.x::date as dia) g
                left join (select (creado_en at time zone v_zona)::date as dia, sum(total) as total, count(*) as n from v group by 1) t on t.dia = g.dia),
    'por_hora', (select coalesce(jsonb_agg(jsonb_build_object('hora', h, 'total', total) order by h), '[]')
                 from (select extract(hour from creado_en at time zone v_zona)::int as h, sum(total) as total from v group by 1) x),
    'por_metodo', (select coalesce(jsonb_agg(jsonb_build_object('metodo', metodo, 'total', total) order by total desc), '[]')
                   from (select pg.metodo, sum(pg.monto) as total from app.pago pg join v on v.id = pg.venta_id group by 1) x),
    'productos', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
                    select d.nombre, sum(d.cantidad) as cantidad, sum(d.total) as total,
                           round(sum(d.base) - sum(d.cantidad * d.costo_unitario), 2) as utilidad
                    from d group by d.nombre order by sum(d.total) desc limit 15) x),
    'categorias', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
                     select coalesce(c.nombre, 'Sin categoría') as categoria, sum(d.total) as total
                     from d left join app.producto pr on pr.id = d.producto_id left join app.categoria c on c.id = pr.categoria_id
                     group by 1) x),
    'vendedores', (select coalesce(jsonb_agg(x order by x.total desc), '[]') from (
                     select coalesce(u.nombre, u.celular) as vendedor, count(*) as ventas, sum(v.total) as total
                     from v left join auth.usuario u on u.id = v.vendedor_id group by 1) x),
    'compras', (select coalesce(sum(total), 0) from app.compra where estado <> 'anulada' and fecha between p_desde and p_hasta),
    'gastos', (select coalesce(sum(monto), 0) from app.gasto where estado = 'vigente' and fecha between p_desde and p_hasta),
    'gastos_categorias', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'total', total) order by total desc), '[]')
                          from (select categoria, sum(monto) as total from app.gasto
                                where estado = 'vigente' and fecha between p_desde and p_hasta group by 1) x),
    'fiado_por_cobrar', (select coalesce(sum(saldo), 0) from app.cliente_saldo where negocio_id = app.negocio_actual() and saldo > 0)
  ) into r;
  return r;
end $$;

-- ---------- El catálogo en línea muestra las fotos ----------

create or replace function app.catalogo_publico(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'negocio', n.nombre, 'tipo', t.nombre, 'mensaje', cc.mensaje, 'whatsapp', cc.whatsapp,
    'acepta_pedidos', cc.acepta_pedidos and exists (select 1 from app.negocio_modulo nm
                        where nm.negocio_id = n.id and nm.modulo = 'M10' and nm.activo),
    'costo_envio', cc.costo_envio,
    'categorias', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre) order by c.orden, c.nombre), '[]')
                   from app.categoria c where c.negocio_id = n.id
                     and exists (select 1 from app.producto p where p.categoria_id = c.id and p.activo and p.precio is not null)),
    'productos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', p.id, 'nombre', p.nombre, 'precio', p.precio, 'unidad', p.unidad, 'categoria_id', p.categoria_id,
                     'foto_version', p.foto_version,
                     'agotado', p.maneja_stock and p.stock <= 0,
                     'variantes', (select jsonb_agg(jsonb_build_object('id', v.id, 'variante', v.variante, 'precio', v.precio,
                                                                       'agotado', v.stock <= 0) order by v.variante)
                                   from app.producto v where v.padre_id = p.id and v.activo and v.precio is not null
                                     and (cc.mostrar_agotados or v.stock > 0)))
                   order by p.nombre), '[]')
                  from app.producto p
                  where p.negocio_id = n.id and p.activo and p.padre_id is null and p.tipo = 'venta' and p.precio is not null
                    and p.nombre <> 'Envío a domicilio'
                    and not exists (select 1 from app.catalogo_oculto o where o.producto_id = p.id)
                    and (cc.mostrar_agotados or not p.maneja_stock or p.stock > 0
                         or exists (select 1 from app.producto v where v.padre_id = p.id and v.stock > 0))))
  from app.catalogo_config cc
  join app.negocio n on n.id = cc.negocio_id
  join catalogo.tipo_negocio t on t.id = n.tipo_negocio_id
  where cc.slug = lower(p_slug) and cc.activo
    and exists (select 1 from app.negocio_modulo nm where nm.negocio_id = n.id and nm.modulo = 'M18' and nm.activo);
$$;

-- ---------- Seguridad ----------

alter table app.producto_foto enable row level security;
create policy aislamiento_negocio on app.producto_foto
  using (negocio_id = app.negocio_actual())
  with check (negocio_id = app.negocio_actual());
grant select, insert, update, delete on app.producto_foto to alcien_app;
grant update on app.gasto to alcien_app;
grant update (nombre) on app.venta_detalle to alcien_app;
grant execute on all functions in schema app to alcien_app;
revoke all on function app.recibo_publico(text) from public;
revoke all on function app.foto_publica(uuid) from public;
revoke all on function app.catalogo_publico(text) from public;
