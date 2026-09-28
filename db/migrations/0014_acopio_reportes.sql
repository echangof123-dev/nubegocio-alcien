-- 0014 · Tanda 5 de módulos: compras a productores / acopio (M25), reportes por periodo (M21)
--        y empleados (M20: cambio de rol y nombre).

-- ---------- Acopio (M25) ----------

-- Productores: son proveedores marcados como tales (con cédula en el campo ruc)
alter table app.proveedor add column es_productor boolean not null default false;

-- Humedad de referencia y precio del día por producto que se acopia
create table app.acopio_producto (
  producto_id    uuid primary key references app.producto(id) on delete cascade,
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  humedad_base   numeric(5,2) not null default 0 check (humedad_base between 0 and 90),
  precio_dia     numeric(12,4) check (precio_dia is null or precio_dia >= 0),
  actualizado_en timestamptz not null default now()
);

-- Anticipos a productores: plata adelantada que se descuenta en la siguiente liquidación
create table app.anticipo (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references app.negocio(id) on delete cascade,
  proveedor_id  uuid not null references app.proveedor(id),
  monto         numeric(12,2) not null check (monto > 0),
  saldo         numeric(12,2) not null check (saldo >= 0),
  metodo        text not null check (metodo in ('efectivo', 'transferencia')),
  turno_id      uuid references app.caja_turno(id),
  nota          text,
  estado        text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  creado_por    uuid references auth.usuario(id),
  creado_en     timestamptz not null default now(),
  check (saldo <= monto)
);
create index anticipo_proveedor_idx on app.anticipo (negocio_id, proveedor_id, creado_en);

-- Pesaje y liquidación de cada compra al productor
create table app.acopio (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  numero          bigint not null,
  compra_id       uuid not null unique references app.compra(id),
  proveedor_id    uuid not null references app.proveedor(id),
  producto_id     uuid not null references app.producto(id),
  sacos           integer check (sacos is null or sacos >= 0),
  peso_bruto      numeric(12,3) not null check (peso_bruto > 0),
  tara            numeric(12,3) not null default 0 check (tara >= 0),
  humedad         numeric(5,2) not null default 0 check (humedad between 0 and 90),
  humedad_base    numeric(5,2) not null default 0 check (humedad_base between 0 and 90),
  impureza        numeric(5,2) not null default 0 check (impureza between 0 and 90),
  peso_neto       numeric(12,3) not null check (peso_neto > 0),
  precio          numeric(12,4) not null check (precio >= 0),
  total           numeric(12,2) not null,
  descontado      numeric(12,2) not null default 0 check (descontado >= 0),     -- anticipos descontados
  pagado          numeric(12,2) not null default 0,                             -- entregado al productor
  estado          text not null default 'vigente' check (estado in ('vigente', 'anulado')),
  creado_por      uuid references auth.usuario(id),
  creado_en       timestamptz not null default now(),
  unique (negocio_id, numero),
  check (peso_bruto > tara)
);
create index acopio_fecha_idx on app.acopio (negocio_id, creado_en desc);

create table app.acopio_anticipo (
  acopio_id    uuid not null references app.acopio(id) on delete cascade,
  anticipo_id  uuid not null references app.anticipo(id),
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  monto        numeric(12,2) not null check (monto > 0),
  primary key (acopio_id, anticipo_id)
);

-- Los anticipos descontados cuentan como pago de la compra
alter table app.pago_compra drop constraint pago_compra_metodo_check;
alter table app.pago_compra add constraint pago_compra_metodo_check check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'anticipo'));

-- Peso neto: se descuenta la tara, la humedad sobre la de referencia (merma de agua) y la impureza.
--   neto = (bruto − tara) × (100 − h) / (100 − h_base) × (1 − impureza / 100)
create or replace function app.peso_neto_acopio(p_bruto numeric, p_tara numeric, p_humedad numeric, p_base numeric, p_impureza numeric)
returns numeric
language sql
immutable
as $$
  select round((p_bruto - coalesce(p_tara, 0))
               * case when coalesce(p_humedad, 0) > coalesce(p_base, 0)
                      then (100 - p_humedad) / (100 - p_base) else 1 end
               * (1 - coalesce(p_impureza, 0) / 100), 3);
$$;

create or replace function app.dar_anticipo(p_proveedor uuid, p_monto numeric, p_metodo text default 'efectivo', p_nota text default null)
returns uuid
language plpgsql
as $$
declare
  v_turno uuid;
  v_id uuid;
begin
  perform app.exigir_modulo('M25');
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador dan anticipos' using errcode = '42501';
  end if;
  if not exists (select 1 from app.proveedor where id = p_proveedor and activo) then
    raise exception 'Productor no encontrado' using errcode = 'P0002';
  end if;
  p_monto := round(p_monto, 2);
  if p_monto is null or p_monto <= 0 then
    raise exception 'Indica el monto del anticipo' using errcode = '22023';
  end if;
  if p_metodo not in ('efectivo', 'transferencia') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;
  if p_metodo = 'efectivo' then
    v_turno := app.turno_abierto();
    if v_turno is not null then
      perform app.movimiento_caja('retiro', p_monto, 'Anticipo a ' || (select nombre from app.proveedor where id = p_proveedor));
    end if;
  end if;
  insert into app.anticipo (negocio_id, proveedor_id, monto, saldo, metodo, turno_id, nota, creado_por)
  values (app.negocio_actual(), p_proveedor, p_monto, p_monto, p_metodo, v_turno, nullif(trim(p_nota), ''),
          nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

-- p: {proveedor_id, producto_id, sacos, peso_bruto, tara, humedad, humedad_base, impureza, precio,
--     metodo ('efectivo'|'transferencia'|'credito'), descontar_anticipo (monto, opcional), nota}
create or replace function app.registrar_acopio(p jsonb)
returns table (acopio_id uuid, numero bigint, peso_neto numeric, total numeric, descontado numeric, a_pagar numeric)
language plpgsql
as $$
declare
  v_prov   app.proveedor%rowtype;
  v_prod   app.producto%rowtype;
  v_cfg    app.acopio_producto%rowtype;
  v_bruto  numeric := round((p->>'peso_bruto')::numeric, 3);
  v_tara   numeric := round(coalesce((p->>'tara')::numeric, 0), 3);
  v_hum    numeric := round(coalesce((p->>'humedad')::numeric, 0), 2);
  v_base   numeric;
  v_imp    numeric := round(coalesce((p->>'impureza')::numeric, 0), 2);
  v_precio numeric;
  v_neto   numeric;
  v_total  numeric;
  v_metodo text := coalesce(p->>'metodo', 'efectivo');
  v_desc   numeric := round(coalesce((p->>'descontar_anticipo')::numeric, 0), 2);
  v_disp   numeric;
  v_compra uuid;
  v_id     uuid;
  v_num    bigint;
  v_resto  numeric;
  a        record;
  v_tomar  numeric;
begin
  perform app.exigir_modulo('M25');
  select * into v_prov from app.proveedor where id = (p->>'proveedor_id')::uuid and activo;
  if not found then
    raise exception 'Elige el productor' using errcode = '22023';
  end if;
  select * into v_prod from app.producto where id = (p->>'producto_id')::uuid and activo;
  if not found then
    raise exception 'Elige qué se compra' using errcode = '22023';
  end if;
  select * into v_cfg from app.acopio_producto where producto_id = v_prod.id;
  v_base := round(coalesce((p->>'humedad_base')::numeric, v_cfg.humedad_base, 0), 2);
  v_precio := round(coalesce((p->>'precio')::numeric, v_cfg.precio_dia), 4);
  if v_bruto is null or v_bruto <= 0 or v_tara >= v_bruto then
    raise exception 'Revisa el peso y la tara' using errcode = '22023';
  end if;
  if v_precio is null or v_precio < 0 then
    raise exception 'Indica el precio' using errcode = '22023';
  end if;
  if v_hum < 0 or v_hum >= 90 or v_imp < 0 or v_imp >= 90 or v_base >= 90 then
    raise exception 'Revisa la humedad y la impureza' using errcode = '22023';
  end if;
  if v_metodo not in ('efectivo', 'transferencia', 'credito') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;

  v_neto := app.peso_neto_acopio(v_bruto, v_tara, v_hum, v_base, v_imp);
  if v_neto <= 0 then
    raise exception 'El peso neto no puede ser cero' using errcode = '22023';
  end if;
  v_total := round(v_neto * v_precio, 2);

  select coalesce(sum(saldo), 0) into v_disp from app.anticipo
  where proveedor_id = v_prov.id and estado = 'vigente' and saldo > 0;
  if v_desc < 0 or v_desc > least(v_disp, v_total) then
    raise exception 'Puedes descontar hasta $ % de anticipos', least(v_disp, v_total) using errcode = '22023';
  end if;

  -- La compra hace el resto: stock, costo promedio y, si se paga de contado, la salida de caja.
  -- Con anticipo se registra a crédito y se paga en partes: primero el anticipo, luego lo demás.
  v_compra := app.registrar_compra(v_prov.id,
    jsonb_build_array(jsonb_build_object('producto_id', v_prod.id, 'cantidad', v_neto, 'costo', v_precio)),
    case when v_desc > 0 then 'credito' else v_metodo end, null,
    format('Acopio: %s bruto, %s tara, %s%% humedad, %s%% impureza', v_bruto, v_tara, v_hum, v_imp) ||
      coalesce(' · ' || nullif(trim(p->>'nota'), ''), ''));
  -- registrar_compra redondea el total igual (cantidad × costo a 2 decimales)
  select c.total into v_total from app.compra c where c.id = v_compra;

  v_num := app.siguiente('acopio');
  insert into app.acopio (negocio_id, numero, compra_id, proveedor_id, producto_id, sacos, peso_bruto, tara, humedad,
                          humedad_base, impureza, peso_neto, precio, total, descontado, creado_por)
  values (app.negocio_actual(), v_num, v_compra, v_prov.id, v_prod.id, nullif(p->>'sacos', '')::int, v_bruto, v_tara, v_hum,
          v_base, v_imp, v_neto, v_precio, v_total, v_desc, nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;

  if v_desc > 0 then
    v_resto := v_desc;
    for a in select * from app.anticipo where proveedor_id = v_prov.id and estado = 'vigente' and saldo > 0
             order by creado_en for update loop
      exit when v_resto <= 0;
      v_tomar := least(a.saldo, v_resto);
      update app.anticipo set saldo = saldo - v_tomar where id = a.id;
      insert into app.acopio_anticipo (acopio_id, anticipo_id, negocio_id, monto) values (v_id, a.id, a.negocio_id, v_tomar);
      v_resto := v_resto - v_tomar;
    end loop;
    insert into app.pago_compra (negocio_id, compra_id, monto, metodo, creado_por)
    values (app.negocio_actual(), v_compra, v_desc, 'anticipo', nullif(current_setting('app.usuario_id', true), '')::uuid);
    update app.compra set pagado = pagado + v_desc where id = v_compra;
    if v_metodo <> 'credito' and v_total - v_desc > 0 then
      perform app.pagar_compra(v_compra, v_total - v_desc, v_metodo);
    end if;
  end if;

  update app.acopio set pagado = (select c.pagado from app.compra c where c.id = v_compra) - v_desc where id = v_id;
  return query select v_id, v_num, v_neto, v_total, v_desc,
    case when v_metodo = 'credito' then 0::numeric else v_total - v_desc end;
end $$;

create or replace function app.anular_acopio(p_acopio uuid, p_motivo text)
returns void
language plpgsql
as $$
declare
  v app.acopio%rowtype;
  x record;
begin
  perform app.exigir_modulo('M25');
  select * into v from app.acopio where id = p_acopio for update;
  if not found or v.estado = 'anulado' then
    raise exception 'Liquidación no encontrada' using errcode = 'P0002';
  end if;
  perform app.anular_compra(v.compra_id, p_motivo);    -- revisa el rol, devuelve stock y caja
  for x in select * from app.acopio_anticipo where acopio_id = v.id loop
    update app.anticipo set saldo = saldo + x.monto where id = x.anticipo_id;
  end loop;
  update app.acopio set estado = 'anulado' where id = v.id;
end $$;

-- ---------- Reportes por periodo (M21) ----------

-- Todo lo del periodo [desde, hasta] (fechas en la zona del negocio) en un solo JSON.
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
    'gastos', (select coalesce(sum(monto), 0) from app.gasto where creado_en >= v_ini and creado_en < v_fin),
    'gastos_categorias', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'total', total) order by total desc), '[]')
                          from (select categoria, sum(monto) as total from app.gasto
                                where creado_en >= v_ini and creado_en < v_fin group by 1) x),
    'fiado_por_cobrar', (select coalesce(sum(saldo), 0) from app.cliente_saldo where negocio_id = app.negocio_actual() and saldo > 0)
  ) into r;
  return r;
end $$;

-- ---------- Seguridad ----------

do $$
declare
  t text;
begin
  foreach t in array array['acopio_producto', 'anticipo', 'acopio', 'acopio_anticipo'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update on app.acopio_producto, app.anticipo, app.acopio, app.acopio_anticipo to alcien_app;
grant execute on all functions in schema app to alcien_app;
