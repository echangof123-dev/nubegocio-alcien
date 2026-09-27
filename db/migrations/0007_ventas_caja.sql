-- 0007 · Etapa 2: clientes, caja, ventas, pagos, fiado e inventario
--
-- Reglas de dinero:
--   · El precio del producto es el que paga el cliente (IVA incluido). La base y el IVA
--     se calculan por línea: base = round(total / (1 + tarifa/100), 2), iva = total - base.
--   · Montos en USD con 2 decimales; cantidades con 3 (venta por peso).
--   · Nada se borra: una venta anulada queda con estado 'anulada' y sus movimientos se revierten.
--
-- Las funciones son SECURITY INVOKER: corren con el rol de la API y la seguridad por fila aplica.

-- ---------- Contadores por negocio (número de venta, etc.) ----------

create table app.contador (
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  clave       text not null,
  valor       bigint not null default 0,
  primary key (negocio_id, clave)
);

create or replace function app.siguiente(p_clave text)
returns bigint
language sql
as $$
  insert into app.contador (negocio_id, clave, valor)
  values (app.negocio_actual(), p_clave, 1)
  on conflict (negocio_id, clave) do update set valor = app.contador.valor + 1
  returning valor;
$$;

-- ---------- Clientes ----------

create table app.cliente (
  id                   uuid primary key default gen_random_uuid(),
  negocio_id           uuid not null references app.negocio(id) on delete cascade,
  nombre               text not null check (length(trim(nombre)) between 1 and 120),
  tipo_identificacion  text check (tipo_identificacion in ('cedula', 'ruc', 'pasaporte')),
  identificacion       text,
  celular              text,
  correo               citext,
  limite_credito       numeric(12,2) check (limite_credito is null or limite_credito >= 0),
  notas                text,
  activo               boolean not null default true,
  creado_en            timestamptz not null default now(),
  check ((tipo_identificacion is null) = (identificacion is null)),
  check (tipo_identificacion is distinct from 'cedula' or identificacion ~ '^[0-9]{10}$'),
  check (tipo_identificacion is distinct from 'ruc' or identificacion ~ '^[0-9]{13}$')
);
create index cliente_negocio_nombre_idx on app.cliente (negocio_id, nombre);
create unique index cliente_identificacion_uq on app.cliente (negocio_id, identificacion) where identificacion is not null;

-- ---------- Inventario ----------

alter table app.producto add column stock numeric(12,3) not null default 0;

create table app.movimiento_inventario (
  id              bigint generated always as identity primary key,
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  producto_id     uuid not null references app.producto(id) on delete cascade,
  tipo            text not null check (tipo in ('inicial', 'venta', 'anulacion', 'compra', 'ajuste')),
  cantidad        numeric(12,3) not null check (cantidad <> 0),     -- positiva entra, negativa sale
  costo_unitario  numeric(12,4),
  referencia_id   uuid,
  motivo          text,
  creado_por      uuid references auth.usuario(id),
  creado_en       timestamptz not null default now()
);
create index movimiento_inventario_producto_idx on app.movimiento_inventario (negocio_id, producto_id, creado_en);

create or replace function app.mover_stock(
  p_producto uuid, p_tipo text, p_cantidad numeric, p_referencia uuid default null,
  p_motivo text default null, p_costo numeric default null
)
returns numeric
language plpgsql
as $$
declare
  v_stock numeric;
begin
  insert into app.movimiento_inventario (negocio_id, producto_id, tipo, cantidad, costo_unitario, referencia_id, motivo, creado_por)
  values (app.negocio_actual(), p_producto, p_tipo, p_cantidad, p_costo, p_referencia, p_motivo,
          nullif(current_setting('app.usuario_id', true), '')::uuid);

  update app.producto set stock = stock + p_cantidad
  where id = p_producto
  returning stock into v_stock;

  return v_stock;
end $$;

-- Deja el stock en un valor contado (conteo físico).
create or replace function app.ajustar_stock(p_producto uuid, p_nuevo numeric, p_motivo text default 'Conteo')
returns numeric
language plpgsql
as $$
declare
  v_actual numeric;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'bodeguero') then
    raise exception 'No tienes permiso para ajustar el inventario' using errcode = '42501';
  end if;
  if p_nuevo < 0 then
    raise exception 'El stock no puede ser negativo' using errcode = '22023';
  end if;

  select stock into v_actual from app.producto where id = p_producto and maneja_stock for update;
  if not found then
    raise exception 'Producto no encontrado o sin control de stock' using errcode = 'P0002';
  end if;
  if p_nuevo = v_actual then
    return v_actual;
  end if;
  return app.mover_stock(p_producto, 'ajuste', p_nuevo - v_actual, null, p_motivo);
end $$;

-- ---------- Caja ----------

create table app.caja_turno (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references app.negocio(id) on delete cascade,
  estado             text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  monto_apertura     numeric(12,2) not null check (monto_apertura >= 0),
  abierto_por        uuid not null references auth.usuario(id),
  abierto_en         timestamptz not null default now(),
  efectivo_esperado  numeric(12,2),
  efectivo_contado   numeric(12,2) check (efectivo_contado is null or efectivo_contado >= 0),
  diferencia         numeric(12,2),
  nota_cierre        text,
  cerrado_por        uuid references auth.usuario(id),
  cerrado_en         timestamptz,
  check ((estado = 'cerrado') = (cerrado_en is not null))
);
-- Una sola caja abierta por negocio (varias cajas llegan con sucursales)
create unique index caja_turno_abierto_uq on app.caja_turno (negocio_id) where estado = 'abierto';

create table app.caja_movimiento (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  turno_id    uuid not null references app.caja_turno(id),
  tipo        text not null check (tipo in ('ingreso', 'retiro')),
  monto       numeric(12,2) not null check (monto > 0),
  motivo      text not null,
  creado_por  uuid references auth.usuario(id),
  creado_en   timestamptz not null default now()
);

create table app.gasto (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  turno_id     uuid references app.caja_turno(id),       -- solo si se pagó en efectivo con la caja abierta
  categoria    text not null,
  descripcion  text,
  monto        numeric(12,2) not null check (monto > 0),
  metodo       text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  creado_por   uuid references auth.usuario(id),
  creado_en    timestamptz not null default now()
);

create or replace function app.turno_abierto()
returns uuid
language sql
stable
as $$
  select id from app.caja_turno where negocio_id = app.negocio_actual() and estado = 'abierto';
$$;

create or replace function app.abrir_caja(p_monto numeric)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if app.turno_abierto() is not null then
    raise exception 'Ya hay una caja abierta' using errcode = '23505';
  end if;
  insert into app.caja_turno (negocio_id, monto_apertura, abierto_por)
  values (app.negocio_actual(), round(coalesce(p_monto, 0), 2), current_setting('app.usuario_id')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.movimiento_caja(p_tipo text, p_monto numeric, p_motivo text)
returns void
language plpgsql
as $$
declare
  v_turno uuid := app.turno_abierto();
begin
  if v_turno is null then
    raise exception 'Abre la caja primero' using errcode = '55000';
  end if;
  insert into app.caja_movimiento (negocio_id, turno_id, tipo, monto, motivo, creado_por)
  values (app.negocio_actual(), v_turno, p_tipo, round(p_monto, 2), p_motivo,
          current_setting('app.usuario_id')::uuid);
end $$;

create or replace function app.registrar_gasto(p_categoria text, p_monto numeric, p_metodo text, p_descripcion text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_turno uuid := case when p_metodo = 'efectivo' then app.turno_abierto() end;
begin
  if coalesce(current_setting('app.rol', true), '') = 'bodeguero' then
    raise exception 'No tienes permiso para registrar gastos' using errcode = '42501';
  end if;
  insert into app.gasto (negocio_id, turno_id, categoria, descripcion, monto, metodo, creado_por)
  values (app.negocio_actual(), v_turno, trim(p_categoria), p_descripcion, round(p_monto, 2), p_metodo,
          current_setting('app.usuario_id')::uuid)
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Ventas ----------

create table app.venta (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references app.negocio(id) on delete cascade,
  numero             bigint not null,
  turno_id           uuid references app.caja_turno(id),
  cliente_id         uuid references app.cliente(id),
  vendedor_id        uuid not null references auth.usuario(id),
  estado             text not null default 'completada' check (estado in ('completada', 'anulada')),
  comprobante        text not null default 'nota' check (comprobante in ('nota', 'factura')),
  subtotal_0         numeric(12,2) not null default 0,     -- base con tarifa 0 %
  subtotal_gravado   numeric(12,2) not null default 0,     -- base con IVA
  iva                numeric(12,2) not null default 0,
  descuento          numeric(12,2) not null default 0,
  total              numeric(12,2) not null check (total >= 0),
  nota               text,
  creado_en          timestamptz not null default now(),
  anulada_en         timestamptz,
  anulada_por        uuid references auth.usuario(id),
  motivo_anulacion   text,
  unique (negocio_id, numero),
  check (subtotal_0 + subtotal_gravado + iva = total),
  check ((estado = 'anulada') = (anulada_en is not null))
);
create index venta_negocio_fecha_idx on app.venta (negocio_id, creado_en desc);
create index venta_turno_idx on app.venta (turno_id);

create table app.venta_detalle (
  id               bigint generated always as identity primary key,
  negocio_id       uuid not null references app.negocio(id) on delete cascade,
  venta_id         uuid not null references app.venta(id) on delete cascade,
  producto_id      uuid references app.producto(id) on delete set null,
  nombre           text not null,                 -- copia del nombre al momento de vender
  cantidad         numeric(12,3) not null check (cantidad > 0),
  precio_unitario  numeric(12,2) not null check (precio_unitario >= 0),
  descuento        numeric(12,2) not null default 0 check (descuento >= 0),
  tarifa_iva       numeric(5,2) not null,
  base             numeric(12,2) not null,
  iva              numeric(12,2) not null,
  total            numeric(12,2) not null check (total >= 0),
  costo_unitario   numeric(12,4),
  check (base + iva = total)
);
create index venta_detalle_venta_idx on app.venta_detalle (venta_id);

create table app.pago (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  venta_id    uuid not null references app.venta(id) on delete cascade,
  metodo      text not null check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'deuna', 'fiado')),
  monto       numeric(12,2) not null check (monto > 0),
  recibido    numeric(12,2),                         -- efectivo entregado por el cliente
  vuelto      numeric(12,2) not null default 0 check (vuelto >= 0),
  referencia  text,
  check (metodo = 'efectivo' or recibido is null),
  check (recibido is null or recibido = monto + vuelto)
);
create index pago_venta_idx on app.pago (venta_id);

-- Fiado: cargos (ventas a crédito) y abonos por cliente. Saldo = cargos - abonos.
create table app.fiado_movimiento (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  cliente_id  uuid not null references app.cliente(id),
  tipo        text not null check (tipo in ('cargo', 'abono')),
  monto       numeric(12,2) not null,             -- negativo solo en cargos que revierten una anulación
  metodo      text check (metodo in ('efectivo', 'transferencia', 'tarjeta', 'deuna')),
  venta_id    uuid references app.venta(id),
  turno_id    uuid references app.caja_turno(id),
  creado_por  uuid references auth.usuario(id),
  creado_en   timestamptz not null default now(),
  check (monto <> 0),
  check (tipo = 'cargo' or (monto > 0 and metodo is not null))
);
create index fiado_cliente_idx on app.fiado_movimiento (negocio_id, cliente_id, creado_en);

create or replace view app.cliente_saldo
with (security_invoker = true)
as
  select c.id as cliente_id, c.negocio_id, c.nombre, c.celular, c.limite_credito,
         coalesce(sum(case when f.tipo = 'cargo' then f.monto else -f.monto end), 0)::numeric(12,2) as saldo,
         max(f.creado_en) filter (where f.tipo = 'cargo' and f.monto > 0) as ultimo_cargo
  from app.cliente c
  left join app.fiado_movimiento f on f.cliente_id = c.id
  group by c.id;

create or replace function app.modulo_activo(p_modulo text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from app.modulos_visibles() where modulo = p_modulo and estado = 'activo');
$$;

-- Registra una venta completa.
--   p_items: [{"producto_id": uuid, "cantidad": 2, "precio": 1.25 (opcional), "descuento": 0 (opcional)}]
--   p_pagos: [{"metodo": "efectivo", "monto": 3.95, "recibido": 5}]
create or replace function app.registrar_venta(
  p_items        jsonb,
  p_pagos        jsonb,
  p_cliente      uuid default null,
  p_comprobante  text default 'nota',
  p_nota         text default null
)
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  v_negocio   uuid := app.negocio_actual();
  v_usuario   uuid := nullif(current_setting('app.usuario_id', true), '')::uuid;
  v_rol       text := coalesce(current_setting('app.rol', true), '');
  v_cfg       app.negocio_config%rowtype;
  v_turno     uuid := app.turno_abierto();
  v_venta     uuid;
  v_numero    bigint;
  v_item      jsonb;
  v_pago      jsonb;
  v_prod      app.producto%rowtype;
  v_cant      numeric;
  v_precio    numeric;
  v_desc      numeric;
  v_tarifa    numeric;
  v_linea     numeric;
  v_base      numeric;
  v_total     numeric := 0;
  v_sub0      numeric := 0;
  v_subg      numeric := 0;
  v_iva       numeric := 0;
  v_descs     numeric := 0;
  v_pagado    numeric := 0;
  v_fiado     numeric := 0;
  v_vuelto    numeric := 0;
  v_metodo    text;
  v_monto     numeric;
  v_recibido  numeric;
  v_saldo     numeric;
  v_limite    numeric;
begin
  if v_negocio is null or v_usuario is null then
    raise exception 'Sin negocio en contexto' using errcode = '42501';
  end if;
  if v_rol not in ('dueno', 'administrador', 'cajero') then
    raise exception 'No tienes permiso para vender' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene productos' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'Demasiadas líneas en una venta' using errcode = '22023';
  end if;
  if jsonb_typeof(p_pagos) is distinct from 'array' or jsonb_array_length(p_pagos) = 0 then
    raise exception 'Indica cómo te pagan' using errcode = '22023';
  end if;
  if p_comprobante not in ('nota', 'factura') then
    raise exception 'Comprobante desconocido' using errcode = '22023';
  end if;
  if p_comprobante = 'factura' and not app.modulo_activo('M19') then
    raise exception 'La facturación electrónica no está activa en tu plan' using errcode = '42501';
  end if;

  select * into v_cfg from app.negocio_config where negocio_id = v_negocio;
  if v_cfg.exige_caja_abierta and v_turno is null then
    raise exception 'Abre la caja para empezar a vender' using errcode = '55000';
  end if;

  if p_cliente is not null and not exists (select 1 from app.cliente where id = p_cliente and activo) then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;

  v_numero := app.siguiente('venta');
  insert into app.venta (negocio_id, numero, turno_id, cliente_id, vendedor_id, comprobante, total, nota)
  values (v_negocio, v_numero, v_turno, p_cliente, v_usuario, p_comprobante, 0, p_nota)
  returning id into v_venta;

  -- Líneas
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from app.producto
    where id = (v_item->>'producto_id')::uuid and activo
    for update;
    if not found then
      raise exception 'Producto no disponible' using errcode = 'P0002';
    end if;

    v_cant := (v_item->>'cantidad')::numeric;
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida para %', v_prod.nombre using errcode = '22023';
    end if;
    if v_cant <> trunc(v_cant) and not app.modulo_activo('M06') then
      raise exception '% se vende por unidades enteras', v_prod.nombre using errcode = '22023';
    end if;

    v_precio := coalesce((v_item->>'precio')::numeric, v_prod.precio);
    if v_precio is null then
      raise exception 'Ponle precio a % antes de venderlo', v_prod.nombre using errcode = '22023';
    end if;
    if v_precio < 0 then
      raise exception 'Precio inválido' using errcode = '22023';
    end if;
    if v_prod.precio is not null and v_precio <> v_prod.precio and v_rol = 'cajero' then
      raise exception 'Solo el dueño o un administrador pueden cambiar precios' using errcode = '42501';
    end if;

    v_desc := round(coalesce((v_item->>'descuento')::numeric, 0), 2);
    v_linea := round(v_cant * v_precio, 2) - v_desc;
    if v_desc < 0 or v_linea < 0 then
      raise exception 'Descuento inválido en %', v_prod.nombre using errcode = '22023';
    end if;
    if v_desc > 0 and v_rol = 'cajero' then
      raise exception 'Solo el dueño o un administrador pueden hacer descuentos' using errcode = '42501';
    end if;

    if v_prod.maneja_stock and not v_cfg.permite_vender_sin_stock and v_prod.stock < v_cant then
      raise exception 'No alcanza el stock de % (quedan %)', v_prod.nombre, v_prod.stock using errcode = '22023';
    end if;

    v_tarifa := coalesce(v_prod.iva, v_cfg.iva_defecto);
    v_base := round(v_linea / (1 + v_tarifa / 100), 2);

    insert into app.venta_detalle (negocio_id, venta_id, producto_id, nombre, cantidad, precio_unitario,
                                   descuento, tarifa_iva, base, iva, total, costo_unitario)
    values (v_negocio, v_venta, v_prod.id, v_prod.nombre, v_cant, v_precio,
            v_desc, v_tarifa, v_base, v_linea - v_base, v_linea, v_prod.costo);

    if v_prod.maneja_stock then
      perform app.mover_stock(v_prod.id, 'venta', -v_cant, v_venta, null, v_prod.costo);
    end if;

    v_total := v_total + v_linea;
    v_descs := v_descs + v_desc;
    v_iva := v_iva + (v_linea - v_base);
    if v_tarifa = 0 then v_sub0 := v_sub0 + v_base; else v_subg := v_subg + v_base; end if;
  end loop;

  -- Pagos
  for v_pago in select * from jsonb_array_elements(p_pagos) loop
    v_metodo := v_pago->>'metodo';
    v_monto := round((v_pago->>'monto')::numeric, 2);
    v_recibido := round((v_pago->>'recibido')::numeric, 2);

    if v_monto is null or v_monto <= 0 then
      raise exception 'Monto de pago inválido' using errcode = '22023';
    end if;
    if v_metodo = 'fiado' then
      if p_cliente is null then
        raise exception 'Para fiar, elige a quién' using errcode = '22023';
      end if;
      if not app.modulo_activo('M14') then
        raise exception 'El fiado no está activo en tu plan' using errcode = '42501';
      end if;
      v_fiado := v_fiado + v_monto;
    elsif v_metodo is null or not (v_metodo = any (v_cfg.metodos_pago)) then
      raise exception 'Método de pago no habilitado: %', coalesce(v_metodo, '(vacío)') using errcode = '22023';
    end if;

    if v_metodo = 'efectivo' then
      v_recibido := coalesce(v_recibido, v_monto);
      if v_recibido < v_monto then
        raise exception 'El efectivo recibido no alcanza' using errcode = '22023';
      end if;
      v_vuelto := v_vuelto + (v_recibido - v_monto);
    else
      v_recibido := null;
    end if;

    insert into app.pago (negocio_id, venta_id, metodo, monto, recibido, vuelto, referencia)
    values (v_negocio, v_venta, v_metodo, v_monto, v_recibido,
            case when v_metodo = 'efectivo' then v_recibido - v_monto else 0 end,
            left(v_pago->>'referencia', 80));
    v_pagado := v_pagado + v_monto;
  end loop;

  if v_pagado <> v_total then
    raise exception 'Los pagos ($ %) no suman el total ($ %)', v_pagado, v_total using errcode = '22023';
  end if;

  -- Fiado: límite de crédito y cargo
  if v_fiado > 0 then
    select saldo, limite_credito into v_saldo, v_limite from app.cliente_saldo where cliente_id = p_cliente;
    if v_limite is not null and v_saldo + v_fiado > v_limite then
      raise exception 'Supera el límite de crédito del cliente ($ %)', v_limite using errcode = '22023';
    end if;
    insert into app.fiado_movimiento (negocio_id, cliente_id, tipo, monto, venta_id, turno_id, creado_por)
    values (v_negocio, p_cliente, 'cargo', v_fiado, v_venta, v_turno, v_usuario);
  end if;

  update app.venta
  set subtotal_0 = v_sub0, subtotal_gravado = v_subg, iva = v_iva, descuento = v_descs, total = v_total
  where id = v_venta;

  return query select v_venta, v_numero, v_total, v_vuelto;
end $$;

create or replace function app.anular_venta(p_venta uuid, p_motivo text)
returns void
language plpgsql
as $$
declare
  v_venta app.venta%rowtype;
  v_det   record;
  v_fiado numeric;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pueden anular ventas' using errcode = '42501';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Escribe el motivo de la anulación' using errcode = '22023';
  end if;

  select * into v_venta from app.venta where id = p_venta for update;
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if v_venta.estado = 'anulada' then
    raise exception 'La venta ya estaba anulada' using errcode = '22023';
  end if;
  if v_venta.comprobante = 'factura' then
    raise exception 'Esta venta tiene factura: emite una nota de crédito' using errcode = '22023';
  end if;

  for v_det in
    select d.producto_id, d.cantidad, p.maneja_stock
    from app.venta_detalle d join app.producto p on p.id = d.producto_id
    where d.venta_id = p_venta
  loop
    if v_det.maneja_stock then
      perform app.mover_stock(v_det.producto_id, 'anulacion', v_det.cantidad, p_venta, p_motivo);
    end if;
  end loop;

  select sum(monto) into v_fiado from app.fiado_movimiento where venta_id = p_venta and tipo = 'cargo';
  if coalesce(v_fiado, 0) <> 0 then
    insert into app.fiado_movimiento (negocio_id, cliente_id, tipo, monto, venta_id, creado_por)
    values (v_venta.negocio_id, v_venta.cliente_id, 'cargo', -v_fiado, p_venta,
            nullif(current_setting('app.usuario_id', true), '')::uuid);
  end if;

  update app.venta
  set estado = 'anulada', anulada_en = now(), motivo_anulacion = trim(p_motivo),
      anulada_por = nullif(current_setting('app.usuario_id', true), '')::uuid
  where id = p_venta;
end $$;

create or replace function app.registrar_abono(p_cliente uuid, p_monto numeric, p_metodo text)
returns numeric
language plpgsql
as $$
declare
  v_saldo numeric;
begin
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'cajero') then
    raise exception 'No tienes permiso para cobrar' using errcode = '42501';
  end if;
  select saldo into v_saldo from app.cliente_saldo where cliente_id = p_cliente;
  if not found then
    raise exception 'Cliente no encontrado' using errcode = 'P0002';
  end if;
  if p_monto is null or p_monto <= 0 or round(p_monto, 2) > v_saldo then
    raise exception 'El abono debe ser mayor a 0 y no pasar la deuda ($ %)', v_saldo using errcode = '22023';
  end if;
  if p_metodo = 'efectivo' and app.turno_abierto() is null then
    raise exception 'Abre la caja para recibir efectivo' using errcode = '55000';
  end if;

  insert into app.fiado_movimiento (negocio_id, cliente_id, tipo, monto, metodo, turno_id, creado_por)
  values (app.negocio_actual(), p_cliente, 'abono', round(p_monto, 2), p_metodo,
          case when p_metodo = 'efectivo' then app.turno_abierto() end,
          nullif(current_setting('app.usuario_id', true), '')::uuid);

  return v_saldo - round(p_monto, 2);
end $$;

-- Resumen de un turno: lo que debe haber por método de pago.
create or replace function app.resumen_caja(p_turno uuid default null)
returns table (
  turno_id           uuid,
  estado             text,
  abierto_en         timestamptz,
  monto_apertura     numeric,
  ventas_cantidad    bigint,
  ventas_total       numeric,
  efectivo_ventas    numeric,
  transferencia      numeric,
  tarjeta            numeric,
  deuna              numeric,
  fiado              numeric,
  abonos_efectivo    numeric,
  ingresos           numeric,
  retiros            numeric,
  gastos_efectivo    numeric,
  efectivo_esperado  numeric,
  efectivo_contado   numeric,
  diferencia         numeric
)
language sql
stable
as $$
  with t as (
    select * from app.caja_turno where id = coalesce(p_turno, app.turno_abierto())
  ),
  pagos as (
    select p.metodo, sum(p.monto) as monto
    from app.pago p join app.venta v on v.id = p.venta_id
    where v.turno_id = (select id from t) and v.estado = 'completada'
    group by p.metodo
  ),
  cifras as (
    select
      (select count(*) from app.venta v where v.turno_id = (select id from t) and v.estado = 'completada') as n,
      (select coalesce(sum(total), 0) from app.venta v where v.turno_id = (select id from t) and v.estado = 'completada') as total,
      coalesce((select monto from pagos where metodo = 'efectivo'), 0) as ef,
      coalesce((select monto from pagos where metodo = 'transferencia'), 0) as tr,
      coalesce((select monto from pagos where metodo = 'tarjeta'), 0) as tj,
      coalesce((select monto from pagos where metodo = 'deuna'), 0) as du,
      coalesce((select monto from pagos where metodo = 'fiado'), 0) as fi,
      (select coalesce(sum(monto), 0) from app.fiado_movimiento f
        where f.turno_id = (select id from t) and f.tipo = 'abono' and f.metodo = 'efectivo') as ab,
      (select coalesce(sum(monto), 0) from app.caja_movimiento m where m.turno_id = (select id from t) and m.tipo = 'ingreso') as ing,
      (select coalesce(sum(monto), 0) from app.caja_movimiento m where m.turno_id = (select id from t) and m.tipo = 'retiro') as ret,
      (select coalesce(sum(monto), 0) from app.gasto g where g.turno_id = (select id from t) and g.metodo = 'efectivo') as gas
  )
  select t.id, t.estado, t.abierto_en, t.monto_apertura,
         c.n, c.total, c.ef, c.tr, c.tj, c.du, c.fi, c.ab, c.ing, c.ret, c.gas,
         coalesce(t.efectivo_esperado, t.monto_apertura + c.ef + c.ab + c.ing - c.ret - c.gas),
         t.efectivo_contado, t.diferencia
  from t cross join cifras c;
$$;

create or replace function app.cerrar_caja(p_contado numeric, p_nota text default null)
returns numeric
language plpgsql
as $$
declare
  v_turno uuid := app.turno_abierto();
  v_esperado numeric;
begin
  if v_turno is null then
    raise exception 'No hay una caja abierta' using errcode = '55000';
  end if;
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador', 'cajero') then
    raise exception 'No tienes permiso para cerrar la caja' using errcode = '42501';
  end if;
  if p_contado is null or p_contado < 0 then
    raise exception 'Escribe el efectivo que contaste' using errcode = '22023';
  end if;

  select efectivo_esperado into v_esperado from app.resumen_caja(v_turno);

  update app.caja_turno
  set estado = 'cerrado', efectivo_esperado = v_esperado, efectivo_contado = round(p_contado, 2),
      diferencia = round(p_contado, 2) - v_esperado, nota_cierre = p_nota,
      cerrado_por = current_setting('app.usuario_id')::uuid, cerrado_en = now()
  where id = v_turno;

  return round(p_contado, 2) - v_esperado;
end $$;

-- Ventas de hoy (en la zona horaria del negocio)
create or replace function app.resumen_hoy()
returns table (ventas bigint, total numeric, ticket_promedio numeric, fiado_por_cobrar numeric)
language sql
stable
as $$
  with n as (select zona_horaria from app.negocio where id = app.negocio_actual()),
  hoy as (
    select v.total
    from app.venta v, n
    where v.negocio_id = app.negocio_actual() and v.estado = 'completada'
      and (v.creado_en at time zone n.zona_horaria)::date = (now() at time zone n.zona_horaria)::date
  )
  select count(*), coalesce(sum(total), 0),
         coalesce(round(avg(total), 2), 0),
         (select coalesce(sum(saldo), 0) from app.cliente_saldo where negocio_id = app.negocio_actual() and saldo > 0)
  from hoy;
$$;

-- ---------- Seguridad por fila y permisos ----------

do $$
declare
  t text;
begin
  foreach t in array array[
    'contador', 'cliente', 'movimiento_inventario', 'caja_turno', 'caja_movimiento', 'gasto',
    'venta', 'venta_detalle', 'pago', 'fiado_movimiento'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update on app.contador to alcien_app;
grant select, insert, update on app.cliente to alcien_app;
grant select, insert on app.movimiento_inventario, app.caja_movimiento, app.gasto, app.venta_detalle,
                        app.pago, app.fiado_movimiento to alcien_app;
grant select, insert, update on app.caja_turno, app.venta to alcien_app;
grant select on app.cliente_saldo to alcien_app;
grant usage on all sequences in schema app to alcien_app;
