-- 0017 · Lo que faltaba de Treinta: deudas (por cobrar y por pagar, también a mano), logo del negocio,
--        combos, propina, productos sin ventas, varios negocios, jornada de empleados y ventas sin internet.

-- ---------- Deudas a mano ----------

-- Clientes: un cargo de fiado sin venta ("me debe 20 del mes pasado")
alter table app.fiado_movimiento add column concepto text check (concepto is null or length(concepto) <= 200);

create or replace function app.registrar_deuda_cliente(p_cliente uuid, p_monto numeric, p_concepto text, p_fecha_pago date default null)
returns numeric
language plpgsql
as $$
declare
  v_saldo numeric;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'cajero') then
    raise exception 'No tienes permiso para anotar deudas' using errcode = '42501';
  end if;
  if not exists (select 1 from app.cliente where id = p_cliente and activo) then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;
  if p_monto is null or round(p_monto, 2) <= 0 then
    raise exception 'Indica el monto de la deuda' using errcode = '22023';
  end if;
  if coalesce(trim(p_concepto), '') = '' then
    raise exception 'Escribe por qué te debe' using errcode = '22023';
  end if;
  insert into app.fiado_movimiento (negocio_id, cliente_id, tipo, monto, concepto, creado_por)
  values (app.negocio_actual(), p_cliente, 'cargo', round(p_monto, 2), trim(p_concepto), nullif(current_setting('app.usuario_id', true), '')::uuid);
  if p_fecha_pago is not null then
    update app.cliente set fecha_pago = p_fecha_pago where id = p_cliente;
  end if;
  select saldo into v_saldo from app.cliente_saldo where cliente_id = p_cliente;
  return v_saldo;
end $$;

-- Proveedores: lo que le debes sin una compra registrada ("le debo 150 de mercadería")
create table app.deuda_proveedor (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references app.negocio(id) on delete cascade,
  proveedor_id  uuid not null references app.proveedor(id),
  concepto      text not null check (length(trim(concepto)) between 1 and 200),
  monto         numeric(12,2) not null check (monto > 0),
  pagado        numeric(12,2) not null default 0 check (pagado >= 0),
  fecha         date not null,
  vence         date,
  estado        text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  creado_por    uuid references auth.usuario(id),
  creado_en     timestamptz not null default now(),
  check (pagado <= monto)
);
create index deuda_proveedor_idx on app.deuda_proveedor (negocio_id, estado, vence);

create table app.pago_deuda_proveedor (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  deuda_id    uuid not null references app.deuda_proveedor(id) on delete cascade,
  monto       numeric(12,2) not null check (monto > 0),
  metodo      text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta')),
  turno_id    uuid references app.caja_turno(id),
  creado_por  uuid references auth.usuario(id),
  creado_en   timestamptz not null default now()
);

create or replace function app.registrar_deuda_proveedor(p_proveedor uuid, p_monto numeric, p_concepto text, p_vence date default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform app.exigir_no_cajero();
  if not exists (select 1 from app.proveedor where id = p_proveedor and activo) then
    raise exception 'Proveedor no encontrado' using errcode = 'P0002';
  end if;
  if p_monto is null or round(p_monto, 2) <= 0 then
    raise exception 'Indica el monto de la deuda' using errcode = '22023';
  end if;
  insert into app.deuda_proveedor (negocio_id, proveedor_id, concepto, monto, fecha, vence, creado_por)
  values (app.negocio_actual(), p_proveedor, coalesce(nullif(trim(p_concepto), ''), 'Deuda'), round(p_monto, 2),
          (now() at time zone (select zona_horaria from app.negocio where id = app.negocio_actual()))::date, p_vence,
          nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.pagar_deuda_proveedor(p_deuda uuid, p_monto numeric, p_metodo text)
returns numeric
language plpgsql
as $$
declare
  d app.deuda_proveedor%rowtype;
  v_turno uuid;
begin
  perform app.exigir_no_cajero();
  select * into d from app.deuda_proveedor where id = p_deuda for update;
  if not found or d.estado <> 'pendiente' then
    raise exception 'La deuda no está pendiente' using errcode = '55000';
  end if;
  p_monto := round(p_monto, 2);
  if p_monto is null or p_monto <= 0 or p_monto > d.monto - d.pagado then
    raise exception 'El pago debe ser entre $0,01 y lo que se debe ($ %)', d.monto - d.pagado using errcode = '22023';
  end if;
  if p_metodo not in ('efectivo', 'transferencia', 'tarjeta') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;
  if p_metodo = 'efectivo' then
    v_turno := app.turno_abierto();
    if v_turno is not null then
      perform app.movimiento_caja('retiro', p_monto, 'Pago a ' || (select nombre from app.proveedor where id = d.proveedor_id));
    end if;
  end if;
  insert into app.pago_deuda_proveedor (negocio_id, deuda_id, monto, metodo, turno_id, creado_por)
  values (d.negocio_id, d.id, p_monto, p_metodo, v_turno, nullif(current_setting('app.usuario_id', true), '')::uuid);
  update app.deuda_proveedor set pagado = pagado + p_monto,
    estado = case when pagado + p_monto >= monto then 'pagada' else 'pendiente' end where id = d.id;
  return d.monto - d.pagado - p_monto;
end $$;

-- ---------- Logo del negocio ----------

create table app.negocio_logo (
  negocio_id     uuid primary key references app.negocio(id) on delete cascade,
  tipo           text not null check (tipo in ('image/jpeg', 'image/webp', 'image/png')),
  datos          bytea not null check (octet_length(datos) <= 200000),
  actualizado_en timestamptz not null default now()
);
alter table app.negocio_config add column logo_version integer;

create or replace function app.logo_publico(p_negocio uuid)
returns table (tipo text, datos bytea)
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select tipo, datos from app.negocio_logo where negocio_id = p_negocio;
$$;

-- ---------- Combos ----------

alter table app.producto add column es_combo boolean not null default false;

-- Un combo se arma con productos que se venden (no con insumos); al venderlo baja el stock de cada uno
create or replace function app.guardar_combo(p_producto uuid, p_componentes jsonb)
returns numeric
language plpgsql
as $$
declare
  v_item jsonb;
  v_costo numeric;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'bodeguero') and not app.tiene_permiso('productos') then
    raise exception 'No tienes permiso para armar combos' using errcode = '42501';
  end if;
  if not exists (select 1 from app.producto where id = p_producto and tipo = 'venta') then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_componentes) <> 'array' or jsonb_array_length(p_componentes) < 1 then
    raise exception 'El combo necesita al menos un producto' using errcode = '22023';
  end if;
  delete from app.receta where producto_id = p_producto;
  for v_item in select * from jsonb_array_elements(p_componentes) loop
    if (v_item->>'producto_id')::uuid = p_producto then
      raise exception 'Un combo no puede incluirse a sí mismo' using errcode = '22023';
    end if;
    if exists (select 1 from app.receta where producto_id = (v_item->>'producto_id')::uuid)
       or exists (select 1 from app.producto where id = (v_item->>'producto_id')::uuid and es_combo) then
      raise exception 'Un combo no puede llevar otro combo' using errcode = '22023';
    end if;
    if coalesce((v_item->>'cantidad')::numeric, 0) <= 0 then
      raise exception 'Cantidad inválida en el combo' using errcode = '22023';
    end if;
    insert into app.receta (negocio_id, producto_id, insumo_id, cantidad)
    values (app.negocio_actual(), p_producto, (v_item->>'producto_id')::uuid, round((v_item->>'cantidad')::numeric, 4));
  end loop;
  update app.producto set es_combo = true, maneja_stock = false where id = p_producto;
  select round(sum(r.cantidad * coalesce(i.costo, 0)), 4) into v_costo
  from app.receta r join app.producto i on i.id = r.insumo_id where r.producto_id = p_producto;
  update app.producto set costo = v_costo where id = p_producto;
  return coalesce(v_costo, 0);
end $$;

create or replace function app.deshacer_combo(p_producto uuid)
returns void
language plpgsql
as $$
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'bodeguero') and not app.tiene_permiso('productos') then
    raise exception 'No tienes permiso' using errcode = '42501';
  end if;
  delete from app.receta where producto_id = p_producto;
  update app.producto set es_combo = false where id = p_producto and es_combo;
end $$;

-- ---------- Propina / servicio ----------

alter table app.producto drop constraint producto_tipo_check;
alter table app.producto add constraint producto_tipo_check check (tipo in ('venta', 'insumo', 'libre', 'propina'));

-- La propina no lleva IVA y no mueve inventario
create or replace function app.producto_propina()
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from app.producto where tipo = 'propina' limit 1;
  if v_id is null then
    insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock, tipo, iva)
    values (app.negocio_actual(), 'Propina', 'Servicio', null, false, 'propina', 0)
    on conflict (negocio_id, nombre) do update set tipo = 'propina', maneja_stock = false, precio = null, iva = 0, activo = true
    returning id into v_id;
  end if;
  return v_id;
end $$;

drop function app.cobrar_cuenta(uuid, bigint[], jsonb, uuid, text);

-- ---------- Jornada de empleados (entrada y salida) ----------

create table app.jornada (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  usuario_id  uuid not null references auth.usuario(id),
  entrada     timestamptz not null default clock_timestamp(),
  salida      timestamptz,
  check (salida is null or salida >= entrada)
);
create unique index jornada_abierta_uq on app.jornada (negocio_id, usuario_id) where salida is null;
create index jornada_fecha_idx on app.jornada (negocio_id, entrada desc);

create or replace function app.marcar_jornada()
returns jsonb
language plpgsql
as $$
declare
  v_usuario uuid := current_setting('app.usuario_id')::uuid;
  j app.jornada%rowtype;
begin
  select * into j from app.jornada where usuario_id = v_usuario and salida is null for update;
  if found then
    update app.jornada set salida = clock_timestamp() where id = j.id returning * into j;
    return jsonb_build_object('estado', 'salida', 'entrada', j.entrada, 'salida', j.salida,
                              'horas', round(extract(epoch from j.salida - j.entrada) / 3600, 2));
  end if;
  insert into app.jornada (negocio_id, usuario_id) values (app.negocio_actual(), v_usuario) returning * into j;
  return jsonb_build_object('estado', 'entrada', 'entrada', j.entrada);
end $$;

-- ---------- Ventas hechas sin internet: la misma venta no se registra dos veces ----------

alter table app.venta add column clave_cliente uuid;
create unique index venta_clave_cliente_uq on app.venta (negocio_id, clave_cliente) where clave_cliente is not null;

create or replace function app.venta_detalle_costo_receta()
returns trigger
language plpgsql
as $$
declare
  v_costo numeric;
begin
  if new.producto_id is not null and exists (select 1 from app.receta where producto_id = new.producto_id)
     and (app.modulo_activo('M08') or exists (select 1 from app.producto where id = new.producto_id and es_combo)) then
    select sum(r.cantidad * coalesce(i.costo, 0)) into v_costo
    from app.receta r join app.producto i on i.id = r.insumo_id where r.producto_id = new.producto_id;
    new.costo_unitario := round(v_costo, 4);
  end if;
  return new;
end $$;

create or replace function app.venta_detalle_descontar_receta()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.producto_id is null or not (app.modulo_activo('M08') or exists (select 1 from app.producto where id = new.producto_id and es_combo)) then
    return null;
  end if;
  for r in select rc.insumo_id, rc.cantidad, i.costo, i.maneja_stock
           from app.receta rc join app.producto i on i.id = rc.insumo_id
           where rc.producto_id = new.producto_id loop
    if r.maneja_stock then
      perform app.mover_stock(r.insumo_id, 'venta', -round(r.cantidad * new.cantidad, 3), new.venta_id,
                              'Receta: ' || new.nombre, r.costo);
    end if;
  end loop;
  return null;
end $$;

create or replace function app.cobrar_cuenta(
  p_cuenta uuid, p_items bigint[], p_pagos jsonb, p_cliente uuid default null, p_comprobante text default 'nota',
  p_propina numeric default 0)
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric, cuenta_cerrada boolean)
language plpgsql
as $$
declare
  c     app.cuenta%rowtype;
  v     record;
  v_items jsonb;
  v_rol text := current_setting('app.rol', true);
  v_quedan integer;
begin
  perform app.exigir_modulo('M09');
  select * into c from app.cuenta where id = p_cuenta for update;
  if not found or c.estado <> 'abierta' then
    raise exception 'La cuenta no está abierta' using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id)
  into v_items
  from app.cuenta_item i
  where i.cuenta_id = c.id and not i.anulado and i.venta_id is null and (p_items is null or i.id = any (p_items));
  if v_items is null then
    raise exception 'No hay nada por cobrar' using errcode = '22023';
  end if;
  if coalesce(p_propina, 0) > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', app.producto_propina(), 'cantidad', 1, 'precio', round(p_propina, 2)));
  end if;

  -- Los precios quedaron fijos al pedir: el cajero cobra aunque el menú haya cambiado después
  perform set_config('app.rol', case when v_rol = 'cajero' then 'administrador' else v_rol end, true);
  select * into v from app.registrar_venta(v_items, p_pagos, p_cliente, p_comprobante,
    coalesce('Mesa ' || (select nombre from app.mesa where id = c.mesa_id), c.nombre, 'Cuenta') || ' · cuenta N.º ' || c.numero) r;
  perform set_config('app.rol', v_rol, true);

  update app.cuenta_item i set venta_id = v.venta_id
  where i.cuenta_id = c.id and not i.anulado and i.venta_id is null and (p_items is null or i.id = any (p_items));

  select count(*) into v_quedan from app.cuenta_item i where i.cuenta_id = c.id and not i.anulado and i.venta_id is null;
  if v_quedan = 0 then
    update app.cuenta set estado = 'cobrada', cerrada_en = now() where id = c.id;
  end if;
  return query select v.venta_id, v.numero, v.total, v.vuelto, v_quedan = 0;
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
    'sin_ventas', (select coalesce(jsonb_agg(x order by x.valor desc nulls last, x.nombre), '[]') from (
                     select p.nombre, p.stock, round(p.stock * p.costo, 2) as valor,
                            (select max(v2.creado_en) from app.venta_detalle d2 join app.venta v2 on v2.id = d2.venta_id
                             where d2.producto_id = p.id and v2.estado <> 'anulada') as ultima_venta
                     from app.producto p
                     where p.activo and p.tipo = 'venta' and p.maneja_stock and p.stock > 0
                       and not exists (select 1 from d where d.producto_id = p.id)
                     order by round(p.stock * p.costo, 2) desc nulls last limit 15) x),
    'fiado_por_cobrar', (select coalesce(sum(saldo), 0) from app.cliente_saldo where negocio_id = app.negocio_actual() and saldo > 0)
  ) into r;
  return r;
end $$;

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
    select 'deuda_proveedor', pd.id::text, pd.creado_en, 'Pago a ' || pr.nombre || ' (' || d.concepto || ')', '', -pd.monto, 0, pd.metodo, null, null
    from app.pago_deuda_proveedor pd join app.deuda_proveedor d on d.id = pd.deuda_id join app.proveedor pr on pr.id = d.proveedor_id
    where d.estado <> 'anulada' and pd.creado_en >= v_ini and pd.creado_en < v_fin
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
    'mensaje', cfg.mensaje_recibo, 'zona', n.zona_horaria, 'negocio_id', n.id, 'logo_version', cfg.logo_version,
    'propina', (select coalesce(sum(d.total), 0) from app.venta_detalle d join app.producto p on p.id = d.producto_id
                where d.venta_id = v.id and p.tipo = 'propina'),
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
    'costo_envio', cc.costo_envio, 'negocio_id', n.id,
    'logo_version', (select logo_version from app.negocio_config where negocio_id = n.id),
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

do $$
declare
  t text;
begin
  foreach t in array array['deuda_proveedor', 'pago_deuda_proveedor', 'negocio_logo', 'jornada'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update on app.deuda_proveedor, app.jornada to alcien_app;
grant select, insert on app.pago_deuda_proveedor to alcien_app;
grant select, insert, update, delete on app.negocio_logo to alcien_app;
grant update (clave_cliente) on app.venta to alcien_app;
grant execute on all functions in schema app to alcien_app;
revoke all on function app.logo_publico(uuid), app.recibo_publico(text), app.catalogo_publico(text), app.foto_publica(uuid) from public;
