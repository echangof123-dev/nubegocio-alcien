-- 0010 · Tanda 1 de módulos: proveedores y compras (M15), lotes y caducidad (M16),
--        cotizaciones (M24) y el catálogo completo de módulos para la pantalla "Módulos".

-- ---------- Prueba gratis con todo ----------
-- Durante los 14 días de prueba el negocio usa todos los módulos (como el plan Pro), para que
-- vea completo lo que su tipo de negocio necesita. Al terminar pasa al plan que elija.
create or replace function app.plan_vigente(p_negocio uuid)
returns text
language sql
stable
as $$
  select case s.estado when 'vencida' then 'gratis' when 'prueba' then 'pro' else s.plan end
  from app.suscripcion s
  where s.negocio_id = p_negocio;
$$;

-- ---------- Todos los módulos, con su estado para este negocio ----------

create or replace function app.modulos_catalogo()
returns table (modulo text, nombre text, descripcion text, fase smallint, estado text,
               plan_requerido text, en_familia boolean, nucleo boolean)
language sql
stable
as $$
  with plan_actual as (select app.plan_vigente(app.negocio_actual()) as plan),
  neg as (select familia from app.negocio where id = app.negocio_actual())
  select m.codigo, m.nombre, m.descripcion, m.fase::smallint,
    case
      when nm.activo and exists (select 1 from catalogo.plan_modulo pm, plan_actual pa
                                 where pm.plan = pa.plan and pm.modulo = m.codigo) then 'activo'
      when nm.activo then 'bloqueado'
      else 'disponible'
    end,
    (select p.codigo from catalogo.plan p join catalogo.plan_modulo pm on pm.plan = p.codigo and pm.modulo = m.codigo
     order by p.orden limit 1),
    exists (select 1 from catalogo.familia_modulo fm, neg where fm.familia = neg.familia and fm.modulo = m.codigo),
    m.tipo = 'nucleo'
  from catalogo.modulo m
  left join app.negocio_modulo nm on nm.modulo = m.codigo and nm.negocio_id = app.negocio_actual()
  order by m.codigo;
$$;

-- ---------- Proveedores ----------

create table app.proveedor (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 1 and 120),
  ruc         text check (ruc is null or ruc ~ '^[0-9]{10}([0-9]{3})?$'),
  celular     text,
  correo      citext,
  notas       text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now(),
  unique (negocio_id, nombre)
);

-- ---------- Compras ----------

create table app.compra (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references app.negocio(id) on delete cascade,
  numero        bigint not null,
  proveedor_id  uuid references app.proveedor(id),
  fecha         date not null,
  documento     text,                                   -- n.º de la factura del proveedor
  metodo        text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'credito')),
  total         numeric(12,2) not null check (total >= 0),
  pagado        numeric(12,2) not null default 0 check (pagado >= 0),
  estado        text not null default 'recibida' check (estado in ('recibida', 'anulada')),
  turno_id      uuid references app.caja_turno(id),     -- si se pagó con efectivo de la caja
  nota          text,
  creado_por    uuid references auth.usuario(id),
  creado_en     timestamptz not null default now(),
  anulada_en    timestamptz,
  unique (negocio_id, numero),
  check (pagado <= total)
);
create index compra_negocio_fecha_idx on app.compra (negocio_id, fecha desc);

create table app.compra_detalle (
  id              bigint generated always as identity primary key,
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  compra_id       uuid not null references app.compra(id) on delete cascade,
  producto_id     uuid not null references app.producto(id),
  cantidad        numeric(12,3) not null check (cantidad > 0),
  costo_unitario  numeric(12,4) not null check (costo_unitario >= 0),
  subtotal        numeric(12,2) not null,
  lote            text,
  vence           date
);
create index compra_detalle_compra_idx on app.compra_detalle (compra_id);

create table app.pago_compra (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  compra_id   uuid not null references app.compra(id) on delete cascade,
  monto       numeric(12,2) not null check (monto > 0),
  metodo      text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta')),
  turno_id    uuid references app.caja_turno(id),
  creado_por  uuid references auth.usuario(id),
  creado_en   timestamptz not null default now()
);

-- ---------- Lotes (M16) ----------

create table app.lote (
  id                uuid primary key default gen_random_uuid(),
  negocio_id        uuid not null references app.negocio(id) on delete cascade,
  producto_id       uuid not null references app.producto(id) on delete cascade,
  codigo            text,
  vence             date not null,
  cantidad_inicial  numeric(12,3) not null check (cantidad_inicial > 0),
  cantidad          numeric(12,3) not null check (cantidad >= 0),
  compra_id         uuid references app.compra(id),
  estado            text not null default 'vigente' check (estado in ('vigente', 'agotado', 'retirado')),
  creado_en         timestamptz not null default now()
);
create index lote_vence_idx on app.lote (negocio_id, vence) where estado = 'vigente';

-- ---------- Cotizaciones (M24) ----------

create table app.cotizacion (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  numero         bigint not null,
  cliente_id     uuid references app.cliente(id),
  estado         text not null default 'abierta' check (estado in ('abierta', 'aceptada', 'anulada')),
  valida_hasta   date not null,
  total          numeric(12,2) not null default 0,
  nota           text,
  venta_id       uuid references app.venta(id),
  token_publico  text not null unique default encode(gen_random_bytes(18), 'hex'),
  creado_por     uuid references auth.usuario(id),
  creado_en      timestamptz not null default now(),
  unique (negocio_id, numero),
  check ((estado = 'aceptada') = (venta_id is not null))
);
create index cotizacion_negocio_fecha_idx on app.cotizacion (negocio_id, creado_en desc);

create table app.cotizacion_detalle (
  id              bigint generated always as identity primary key,
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  cotizacion_id   uuid not null references app.cotizacion(id) on delete cascade,
  producto_id     uuid references app.producto(id) on delete set null,
  nombre          text not null,
  cantidad        numeric(12,3) not null check (cantidad > 0),
  precio          numeric(12,2) not null check (precio >= 0),
  descuento       numeric(12,2) not null default 0 check (descuento >= 0),
  total           numeric(12,2) not null check (total >= 0)
);

-- ---------- Funciones ----------

create or replace function app.exigir_modulo(p_modulo text)
returns void
language plpgsql
stable
as $$
begin
  if not app.modulo_activo(p_modulo) then
    raise exception 'El módulo % no está activo en tu negocio o tu plan',
      (select nombre from catalogo.modulo where codigo = p_modulo) using errcode = '42501';
  end if;
end $$;

create or replace function app.exigir_no_cajero()
returns void
language plpgsql
stable
as $$
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'bodeguero') then
    raise exception 'No tienes permiso para esto' using errcode = '42501';
  end if;
end $$;

-- p_items: [{"producto_id": uuid, "cantidad": 10, "costo": 0.85, "lote": "A12" (opcional), "vence": "2026-12-31" (opcional)}]
create or replace function app.registrar_compra(
  p_proveedor uuid, p_items jsonb, p_metodo text, p_documento text default null,
  p_nota text default null, p_fecha date default null)
returns uuid
language plpgsql
as $$
declare
  v_neg    uuid := app.negocio_actual();
  v_id     uuid;
  v_item   jsonb;
  v_prod   app.producto%rowtype;
  v_cant   numeric;
  v_costo  numeric;
  v_total  numeric := 0;
  v_turno  uuid;
  v_vence  date;
begin
  perform app.exigir_modulo('M15');
  perform app.exigir_no_cajero();
  if p_metodo not in ('efectivo', 'transferencia', 'tarjeta', 'credito') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;
  if p_metodo = 'credito' and p_proveedor is null then
    raise exception 'Para comprar a crédito, elige el proveedor' using errcode = '22023';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene productos' using errcode = '22023';
  end if;

  insert into app.compra (negocio_id, numero, proveedor_id, fecha, documento, metodo, total, nota, creado_por)
  values (v_neg, app.siguiente('compra'), p_proveedor,
          coalesce(p_fecha, (now() at time zone (select zona_horaria from app.negocio where id = v_neg))::date),
          nullif(trim(p_documento), ''), p_metodo, 0, nullif(trim(p_nota), ''),
          nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from app.producto where id = (v_item->>'producto_id')::uuid for update;
    if not found then
      raise exception 'Producto no encontrado' using errcode = 'P0002';
    end if;
    v_cant := round((v_item->>'cantidad')::numeric, 3);
    v_costo := round((v_item->>'costo')::numeric, 4);
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida en %', v_prod.nombre using errcode = '22023';
    end if;
    if v_costo is null or v_costo < 0 then
      raise exception 'Costo inválido en %', v_prod.nombre using errcode = '22023';
    end if;
    v_vence := nullif(v_item->>'vence', '')::date;

    insert into app.compra_detalle (negocio_id, compra_id, producto_id, cantidad, costo_unitario, subtotal, lote, vence)
    values (v_neg, v_id, v_prod.id, v_cant, v_costo, round(v_cant * v_costo, 2), nullif(v_item->>'lote', ''), v_vence);
    v_total := v_total + round(v_cant * v_costo, 2);

    -- Costo promedio ponderado
    update app.producto
    set costo = case when v_prod.maneja_stock and v_prod.stock > 0 and v_prod.costo is not null
                     then round((v_prod.stock * v_prod.costo + v_cant * v_costo) / (v_prod.stock + v_cant), 4)
                     else v_costo end
    where id = v_prod.id;

    if v_prod.maneja_stock then
      perform app.mover_stock(v_prod.id, 'compra', v_cant, v_id, 'Compra', v_costo);
    end if;

    if v_vence is not null and app.modulo_activo('M16') then
      insert into app.lote (negocio_id, producto_id, codigo, vence, cantidad_inicial, cantidad, compra_id)
      values (v_neg, v_prod.id, nullif(v_item->>'lote', ''), v_vence, v_cant, v_cant, v_id);
    end if;
  end loop;

  update app.compra set total = v_total where id = v_id;

  -- Pago al contado. Si es efectivo y la caja está abierta, sale de la caja.
  if p_metodo <> 'credito' then
    if p_metodo = 'efectivo' then
      v_turno := app.turno_abierto();
      if v_turno is not null and v_total > 0 then
        perform app.movimiento_caja('retiro', v_total, 'Compra N.º ' || (select numero from app.compra where id = v_id));
      end if;
    end if;
    update app.compra set pagado = v_total, turno_id = v_turno where id = v_id;
    insert into app.pago_compra (negocio_id, compra_id, monto, metodo, turno_id, creado_por)
    select v_neg, v_id, v_total, p_metodo, v_turno, nullif(current_setting('app.usuario_id', true), '')::uuid
    where v_total > 0;
  end if;

  return v_id;
end $$;

create or replace function app.pagar_compra(p_compra uuid, p_monto numeric, p_metodo text)
returns numeric
language plpgsql
as $$
declare
  v app.compra%rowtype;
  v_turno uuid;
begin
  perform app.exigir_modulo('M15');
  perform app.exigir_no_cajero();
  select * into v from app.compra where id = p_compra for update;
  if not found or v.estado = 'anulada' then
    raise exception 'Compra no encontrada' using errcode = 'P0002';
  end if;
  p_monto := round(p_monto, 2);
  if p_monto is null or p_monto <= 0 or p_monto > v.total - v.pagado then
    raise exception 'El pago debe ser entre $0,01 y lo que se debe ($ %)', v.total - v.pagado using errcode = '22023';
  end if;
  if p_metodo not in ('efectivo', 'transferencia', 'tarjeta') then
    raise exception 'Forma de pago inválida' using errcode = '22023';
  end if;
  if p_metodo = 'efectivo' then
    v_turno := app.turno_abierto();
    if v_turno is not null then
      perform app.movimiento_caja('retiro', p_monto, 'Pago de la compra N.º ' || v.numero);
    end if;
  end if;
  insert into app.pago_compra (negocio_id, compra_id, monto, metodo, turno_id, creado_por)
  values (v.negocio_id, v.id, p_monto, p_metodo, v_turno, nullif(current_setting('app.usuario_id', true), '')::uuid);
  update app.compra set pagado = pagado + p_monto where id = v.id;
  return v.total - v.pagado - p_monto;
end $$;

create or replace function app.anular_compra(p_compra uuid, p_motivo text)
returns void
language plpgsql
as $$
declare
  v app.compra%rowtype;
  d record;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pueden anular compras' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;
  select * into v from app.compra where id = p_compra for update;
  if not found then
    raise exception 'Compra no encontrada' using errcode = 'P0002';
  end if;
  if v.estado = 'anulada' then
    raise exception 'La compra ya estaba anulada' using errcode = '22023';
  end if;
  for d in select cd.producto_id, cd.cantidad, p.maneja_stock
           from app.compra_detalle cd join app.producto p on p.id = cd.producto_id where cd.compra_id = v.id loop
    if d.maneja_stock then
      perform app.mover_stock(d.producto_id, 'ajuste', -d.cantidad, v.id, 'Anulación de compra: ' || trim(p_motivo));
    end if;
  end loop;
  update app.lote set estado = 'retirado', cantidad = 0 where compra_id = v.id;
  -- El efectivo que salió de una caja todavía abierta vuelve a ella
  if exists (select 1 from app.pago_compra where compra_id = v.id and metodo = 'efectivo' and turno_id = app.turno_abierto()) then
    perform app.movimiento_caja('ingreso',
      (select sum(monto) from app.pago_compra where compra_id = v.id and metodo = 'efectivo' and turno_id = app.turno_abierto()),
      'Anulación de la compra N.º ' || v.numero);
  end if;
  update app.compra set estado = 'anulada', anulada_en = now(),
    nota = coalesce(nota || ' · ', '') || 'Anulada: ' || trim(p_motivo)
  where id = v.id;
end $$;

-- Lotes: retirar (vencido, dañado) o marcar agotado
create or replace function app.cerrar_lote(p_lote uuid, p_estado text, p_descontar boolean default false)
returns void
language plpgsql
as $$
declare
  v app.lote%rowtype;
begin
  perform app.exigir_modulo('M16');
  perform app.exigir_no_cajero();
  if p_estado not in ('agotado', 'retirado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  select * into v from app.lote where id = p_lote for update;
  if not found then
    raise exception 'Lote no encontrado' using errcode = 'P0002';
  end if;
  -- Al retirar productos vencidos, también salen del stock
  if p_descontar and v.cantidad > 0 and (select maneja_stock from app.producto where id = v.producto_id) then
    perform app.mover_stock(v.producto_id, 'ajuste', -v.cantidad, v.id, 'Lote retirado (vencido o dañado)');
  end if;
  update app.lote set estado = p_estado, cantidad = 0 where id = v.id;
end $$;

-- p_items: [{"producto_id": uuid, "cantidad": 2, "precio": 1.25 (opcional), "descuento": 0 (opcional)}]
create or replace function app.guardar_cotizacion(
  p_cliente uuid, p_items jsonb, p_dias_validez integer default 15, p_nota text default null)
returns uuid
language plpgsql
as $$
declare
  v_neg   uuid := app.negocio_actual();
  v_id    uuid;
  v_item  jsonb;
  v_prod  app.producto%rowtype;
  v_cant  numeric;
  v_precio numeric;
  v_desc  numeric;
  v_linea numeric;
  v_total numeric := 0;
  v_rol   text := coalesce(current_setting('app.rol', true), '');
begin
  perform app.exigir_modulo('M24');
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La cotización no tiene productos' using errcode = '22023';
  end if;
  if p_dias_validez is null or p_dias_validez < 1 or p_dias_validez > 180 then
    raise exception 'La validez debe ser entre 1 y 180 días' using errcode = '22023';
  end if;

  insert into app.cotizacion (negocio_id, numero, cliente_id, valida_hasta, nota, creado_por)
  values (v_neg, app.siguiente('cotizacion'), p_cliente,
          (now() at time zone (select zona_horaria from app.negocio where id = v_neg))::date + p_dias_validez,
          nullif(trim(p_nota), ''), nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from app.producto where id = (v_item->>'producto_id')::uuid;
    if not found then
      raise exception 'Producto no encontrado' using errcode = 'P0002';
    end if;
    v_cant := round((v_item->>'cantidad')::numeric, 3);
    v_precio := round(coalesce((v_item->>'precio')::numeric, v_prod.precio), 2);
    v_desc := round(coalesce((v_item->>'descuento')::numeric, 0), 2);
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida en %', v_prod.nombre using errcode = '22023';
    end if;
    if v_precio is null then
      raise exception 'Ponle precio a % antes de cotizarlo', v_prod.nombre using errcode = '22023';
    end if;
    if v_rol = 'cajero' and (v_precio <> v_prod.precio or v_desc > 0) then
      raise exception 'Solo el dueño o un administrador pueden cambiar precios o dar descuentos' using errcode = '42501';
    end if;
    v_linea := round(v_cant * v_precio, 2) - v_desc;
    if v_linea < 0 then
      raise exception 'Descuento inválido en %', v_prod.nombre using errcode = '22023';
    end if;
    insert into app.cotizacion_detalle (negocio_id, cotizacion_id, producto_id, nombre, cantidad, precio, descuento, total)
    values (v_neg, v_id, v_prod.id, v_prod.nombre, v_cant, v_precio, v_desc, v_linea);
    v_total := v_total + v_linea;
  end loop;

  update app.cotizacion set total = v_total where id = v_id;
  return v_id;
end $$;

-- Convierte la cotización en venta con sus mismos precios. Los pagos llegan como en registrar_venta.
create or replace function app.convertir_cotizacion(p_cotizacion uuid, p_pagos jsonb, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  c app.cotizacion%rowtype;
  v record;
  v_items jsonb;
begin
  perform app.exigir_modulo('M24');
  select * into c from app.cotizacion where id = p_cotizacion for update;
  if not found then
    raise exception 'Cotización no encontrada' using errcode = 'P0002';
  end if;
  if c.estado <> 'abierta' then
    raise exception 'La cotización ya está %', c.estado using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object('producto_id', d.producto_id, 'cantidad', d.cantidad, 'precio', d.precio,
                                      'descuento', d.descuento) order by d.id)
  into v_items from app.cotizacion_detalle d where d.cotizacion_id = c.id and d.producto_id is not null;
  if v_items is null then
    raise exception 'Los productos de la cotización ya no existen' using errcode = '22023';
  end if;
  select * into v from app.registrar_venta(v_items, p_pagos, c.cliente_id, p_comprobante, 'Cotización N.º ' || c.numero) r;
  update app.cotizacion set estado = 'aceptada', venta_id = v.venta_id where id = c.id;
  return query select v.venta_id, v.numero, v.total, v.vuelto;
end $$;

-- Enlace público de la cotización (para enviarla al cliente)
create or replace function app.cotizacion_publica(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'numero', c.numero, 'estado', c.estado, 'fecha', c.creado_en, 'valida_hasta', c.valida_hasta,
    'total', c.total, 'nota', c.nota,
    'negocio', n.nombre, 'ruc', coalesce(s.ruc, n.ruc), 'direccion', s.dir_establecimiento,
    'cliente', cl.nombre, 'cliente_identificacion', cl.identificacion,
    'lineas', (select jsonb_agg(jsonb_build_object('nombre', d.nombre, 'cantidad', d.cantidad, 'precio', d.precio,
                                                   'descuento', d.descuento, 'total', d.total) order by d.id)
               from app.cotizacion_detalle d where d.cotizacion_id = c.id))
  from app.cotizacion c
  join app.negocio n on n.id = c.negocio_id
  left join app.sri_config s on s.negocio_id = c.negocio_id
  left join app.cliente cl on cl.id = c.cliente_id
  where c.token_publico = p_token and length(p_token) = 36;
$$;

-- ---------- Seguridad ----------

do $$
declare
  t text;
begin
  foreach t in array array['proveedor', 'compra', 'compra_detalle', 'pago_compra', 'lote', 'cotizacion', 'cotizacion_detalle'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update on app.proveedor, app.compra, app.lote, app.cotizacion to alcien_app;
grant select, insert on app.compra_detalle, app.pago_compra, app.cotizacion_detalle to alcien_app;
revoke all on function app.cotizacion_publica(text) from public;
grant execute on all functions in schema app to alcien_app;
grant usage on all sequences in schema app to alcien_app;
