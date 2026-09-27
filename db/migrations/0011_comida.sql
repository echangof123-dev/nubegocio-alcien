-- 0011 · Tanda 2 de módulos (comida): recetas e insumos (M08), mesas y comandas (M09),
--        pedidos y delivery (M10).

-- ---------- Insumos y recetas (M08) ----------

-- Un insumo se compra y se gasta en recetas, pero no aparece en Vender.
alter table app.producto add column tipo text not null default 'venta' check (tipo in ('venta', 'insumo'));

create table app.receta (
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  producto_id  uuid not null references app.producto(id) on delete cascade,   -- lo que se vende (el plato)
  insumo_id    uuid not null references app.producto(id) on delete cascade,   -- lo que gasta
  cantidad     numeric(12,4) not null check (cantidad > 0),                   -- por cada unidad vendida
  primary key (producto_id, insumo_id),
  check (producto_id <> insumo_id)
);
create index receta_insumo_idx on app.receta (insumo_id);

-- p_insumos: [{"insumo_id": uuid, "cantidad": 0.15}] — reemplaza la receta completa
create or replace function app.guardar_receta(p_producto uuid, p_insumos jsonb)
returns numeric
language plpgsql
as $$
declare
  v_item jsonb;
  v_costo numeric;
begin
  perform app.exigir_modulo('M08');
  perform app.exigir_no_cajero();
  if not exists (select 1 from app.producto where id = p_producto) then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  delete from app.receta where producto_id = p_producto;
  for v_item in select * from jsonb_array_elements(coalesce(p_insumos, '[]')) loop
    if (v_item->>'insumo_id')::uuid = p_producto then
      raise exception 'Un producto no puede ser insumo de sí mismo' using errcode = '22023';
    end if;
    if exists (select 1 from app.receta where producto_id = (v_item->>'insumo_id')::uuid) then
      raise exception 'Un insumo no puede tener receta propia' using errcode = '22023';
    end if;
    insert into app.receta (negocio_id, producto_id, insumo_id, cantidad)
    values (app.negocio_actual(), p_producto, (v_item->>'insumo_id')::uuid, round((v_item->>'cantidad')::numeric, 4));
  end loop;
  -- El plato no lleva stock propio: lo que baja es el stock de sus insumos
  if exists (select 1 from app.receta where producto_id = p_producto) then
    update app.producto set maneja_stock = false where id = p_producto;
  end if;
  select round(sum(r.cantidad * coalesce(i.costo, 0)), 4) into v_costo
  from app.receta r join app.producto i on i.id = r.insumo_id where r.producto_id = p_producto;
  return coalesce(v_costo, 0);
end $$;

-- Al vender un producto con receta: el costo sale de los insumos y el stock de los insumos baja.
create or replace function app.venta_detalle_costo_receta()
returns trigger
language plpgsql
as $$
declare
  v_costo numeric;
begin
  if new.producto_id is not null and exists (select 1 from app.receta where producto_id = new.producto_id)
     and app.modulo_activo('M08') then
    select sum(r.cantidad * coalesce(i.costo, 0)) into v_costo
    from app.receta r join app.producto i on i.id = r.insumo_id where r.producto_id = new.producto_id;
    new.costo_unitario := round(v_costo, 4);
  end if;
  return new;
end $$;

create trigger venta_detalle_costo_receta before insert on app.venta_detalle
  for each row execute function app.venta_detalle_costo_receta();

create or replace function app.venta_detalle_descontar_receta()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.producto_id is null or not app.modulo_activo('M08') then
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

create trigger venta_detalle_descontar_receta after insert on app.venta_detalle
  for each row execute function app.venta_detalle_descontar_receta();

-- Al anular la venta, vuelven exactamente los insumos que se gastaron
create or replace function app.venta_anulada_devolver_receta()
returns trigger
language plpgsql
as $$
declare
  m record;
begin
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    for m in select producto_id, sum(cantidad) as cantidad from app.movimiento_inventario
             where referencia_id = new.id and tipo = 'venta' and motivo like 'Receta: %'
             group by producto_id loop
      perform app.mover_stock(m.producto_id, 'anulacion', -m.cantidad, new.id, 'Anulación de venta (receta)');
    end loop;
  end if;
  return null;
end $$;

create trigger venta_anulada_devolver_receta after update of estado on app.venta
  for each row execute function app.venta_anulada_devolver_receta();

-- ---------- Mesas y comandas (M09) ----------

create table app.mesa (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 1 and 40),
  zona        text,
  orden       integer not null default 0,
  activa      boolean not null default true,
  unique (negocio_id, nombre)
);

create table app.cuenta (
  id          uuid primary key default gen_random_uuid(),
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  numero      bigint not null,
  mesa_id     uuid references app.mesa(id),
  nombre      text,                                           -- "Para llevar", "Barra", el nombre del cliente
  personas    smallint check (personas is null or personas between 1 and 100),
  estado      text not null default 'abierta' check (estado in ('abierta', 'cobrada', 'anulada')),
  abierta_por uuid references auth.usuario(id),
  abierta_en  timestamptz not null default now(),
  cerrada_en  timestamptz,
  unique (negocio_id, numero)
);
create unique index cuenta_mesa_abierta_uq on app.cuenta (mesa_id) where estado = 'abierta' and mesa_id is not null;

create table app.cuenta_item (
  id           bigint generated always as identity primary key,
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  cuenta_id    uuid not null references app.cuenta(id) on delete cascade,
  producto_id  uuid not null references app.producto(id),
  nombre       text not null,
  cantidad     numeric(12,3) not null check (cantidad > 0),
  precio       numeric(12,2) not null check (precio >= 0),
  nota         text,
  cocina       text not null default 'pendiente' check (cocina in ('pendiente', 'enviado', 'listo', 'entregado')),
  enviado_en   timestamptz,
  venta_id     uuid references app.venta(id),                 -- cuando se cobró
  anulado      boolean not null default false,
  creado_por   uuid references auth.usuario(id),
  creado_en    timestamptz not null default now()
);
create index cuenta_item_cuenta_idx on app.cuenta_item (cuenta_id);
create index cuenta_item_cocina_idx on app.cuenta_item (negocio_id, cocina) where cocina in ('enviado', 'listo') and not anulado;

create or replace function app.abrir_cuenta(p_mesa uuid, p_nombre text default null, p_personas integer default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform app.exigir_modulo('M09');
  if coalesce(current_setting('app.rol', true), '') = 'bodeguero' then
    raise exception 'No tienes permiso para atender mesas' using errcode = '42501';
  end if;
  if p_mesa is not null then
    select id into v_id from app.cuenta where mesa_id = p_mesa and estado = 'abierta';
    if found then return v_id; end if;           -- la mesa ya tiene cuenta: se usa esa
    if not exists (select 1 from app.mesa where id = p_mesa and activa) then
      raise exception 'Mesa no encontrada' using errcode = 'P0002';
    end if;
  elsif coalesce(trim(p_nombre), '') = '' then
    raise exception 'Ponle un nombre a la cuenta (por ejemplo, el del cliente)' using errcode = '22023';
  end if;
  insert into app.cuenta (negocio_id, numero, mesa_id, nombre, personas, abierta_por)
  values (app.negocio_actual(), app.siguiente('cuenta'), p_mesa, nullif(trim(p_nombre), ''), p_personas,
          nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

-- p_items: [{"producto_id": uuid, "cantidad": 2, "nota": "sin cebolla"}]
create or replace function app.agregar_a_cuenta(p_cuenta uuid, p_items jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_prod app.producto%rowtype;
  v_cant numeric;
begin
  perform app.exigir_modulo('M09');
  if not exists (select 1 from app.cuenta where id = p_cuenta and estado = 'abierta') then
    raise exception 'La cuenta no está abierta' using errcode = '55000';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from app.producto where id = (v_item->>'producto_id')::uuid and activo;
    if not found then
      raise exception 'Producto no disponible' using errcode = 'P0002';
    end if;
    if v_prod.precio is null then
      raise exception 'Ponle precio a % antes de venderlo', v_prod.nombre using errcode = '22023';
    end if;
    v_cant := round((v_item->>'cantidad')::numeric, 3);
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida' using errcode = '22023';
    end if;
    insert into app.cuenta_item (negocio_id, cuenta_id, producto_id, nombre, cantidad, precio, nota, creado_por)
    values (app.negocio_actual(), p_cuenta, v_prod.id, v_prod.nombre, v_cant, v_prod.precio,
            nullif(left(trim(v_item->>'nota'), 120), ''), nullif(current_setting('app.usuario_id', true), '')::uuid);
  end loop;
end $$;

create or replace function app.quitar_de_cuenta(p_item bigint)
returns void
language plpgsql
as $$
declare
  v app.cuenta_item%rowtype;
begin
  select * into v from app.cuenta_item where id = p_item for update;
  if not found or v.anulado or v.venta_id is not null then
    raise exception 'Ese producto ya no se puede quitar' using errcode = '55000';
  end if;
  -- Lo que ya salió a cocina solo lo quita el dueño o un administrador
  if v.cocina <> 'pendiente' and coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Ya se envió a cocina: pide a un administrador que lo quite' using errcode = '42501';
  end if;
  update app.cuenta_item set anulado = true where id = p_item;
end $$;

create or replace function app.enviar_a_cocina(p_cuenta uuid)
returns integer
language sql
as $$
  with e as (
    update app.cuenta_item set cocina = 'enviado', enviado_en = now()
    where cuenta_id = p_cuenta and cocina = 'pendiente' and not anulado
    returning 1)
  select count(*)::int from e;
$$;

create or replace function app.marcar_cocina(p_item bigint, p_estado text)
returns void
language plpgsql
as $$
begin
  if p_estado not in ('listo', 'entregado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  update app.cuenta_item set cocina = p_estado where id = p_item and cocina in ('enviado', 'listo') and not anulado;
  if not found then
    raise exception 'Ese producto no está en cocina' using errcode = '55000';
  end if;
end $$;

create or replace function app.mover_cuenta(p_cuenta uuid, p_mesa uuid)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from app.cuenta where mesa_id = p_mesa and estado = 'abierta') then
    raise exception 'Esa mesa ya está ocupada' using errcode = '55000';
  end if;
  update app.cuenta set mesa_id = p_mesa where id = p_cuenta and estado = 'abierta';
  if not found then
    raise exception 'La cuenta no está abierta' using errcode = '55000';
  end if;
end $$;

-- Cobra toda la cuenta o solo algunos productos (dividir la cuenta).
create or replace function app.cobrar_cuenta(
  p_cuenta uuid, p_items bigint[], p_pagos jsonb, p_cliente uuid default null, p_comprobante text default 'nota')
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

create or replace function app.anular_cuenta(p_cuenta uuid)
returns void
language plpgsql
as $$
begin
  if exists (select 1 from app.cuenta_item where cuenta_id = p_cuenta and venta_id is not null) then
    raise exception 'Esta cuenta ya tiene cobros: anula esas ventas desde Reportes' using errcode = '55000';
  end if;
  if exists (select 1 from app.cuenta_item where cuenta_id = p_cuenta and cocina <> 'pendiente' and not anulado)
     and coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Ya se envió a cocina: pide a un administrador que la anule' using errcode = '42501';
  end if;
  update app.cuenta set estado = 'anulada', cerrada_en = now() where id = p_cuenta and estado = 'abierta';
  if not found then
    raise exception 'La cuenta no está abierta' using errcode = '55000';
  end if;
  update app.cuenta_item set anulado = true where cuenta_id = p_cuenta;
end $$;

-- ---------- Pedidos y delivery (M10) ----------

create table app.pedido (
  id            uuid primary key default gen_random_uuid(),
  negocio_id    uuid not null references app.negocio(id) on delete cascade,
  numero        bigint not null,
  tipo          text not null check (tipo in ('retiro', 'domicilio')),
  canal         text not null default 'local' check (canal in ('local', 'telefono', 'whatsapp', 'catalogo')),
  cliente_id    uuid references app.cliente(id),
  nombre        text not null,
  celular       text,
  direccion     text,
  referencia    text,
  costo_envio   numeric(12,2) not null default 0 check (costo_envio >= 0),
  hora_entrega  timestamptz,
  estado        text not null default 'recibido'
                check (estado in ('recibido', 'preparando', 'listo', 'en_camino', 'entregado', 'cancelado')),
  repartidor    text,
  subtotal      numeric(12,2) not null default 0,
  nota          text,
  venta_id      uuid references app.venta(id),
  creado_por    uuid references auth.usuario(id),
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (negocio_id, numero),
  check (tipo = 'retiro' or direccion is not null)
);
create index pedido_negocio_estado_idx on app.pedido (negocio_id, estado, creado_en);

create table app.pedido_item (
  id           bigint generated always as identity primary key,
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  pedido_id    uuid not null references app.pedido(id) on delete cascade,
  producto_id  uuid not null references app.producto(id),
  nombre       text not null,
  cantidad     numeric(12,3) not null check (cantidad > 0),
  precio       numeric(12,2) not null check (precio >= 0),
  nota         text
);
create index pedido_item_pedido_idx on app.pedido_item (pedido_id);

-- El envío se cobra como una línea más de la venta
create or replace function app.producto_envio()
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  select id into v_id from app.producto where nombre = 'Envío a domicilio';
  if v_id is null then
    insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock)
    values (app.negocio_actual(), 'Envío a domicilio', 'Servicio', null, false)
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- p: {tipo, canal, cliente_id, nombre, celular, direccion, referencia, costo_envio, hora_entrega, nota,
--     items: [{producto_id, cantidad, nota}]}
create or replace function app.crear_pedido(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id    uuid;
  v_item  jsonb;
  v_prod  app.producto%rowtype;
  v_cant  numeric;
  v_sub   numeric := 0;
  v_cli   app.cliente%rowtype;
begin
  perform app.exigir_modulo('M10');
  if coalesce(current_setting('app.rol', true), '') = 'bodeguero' then
    raise exception 'No tienes permiso para tomar pedidos' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'El pedido no tiene productos' using errcode = '22023';
  end if;
  if p->>'cliente_id' is not null then
    select * into v_cli from app.cliente where id = (p->>'cliente_id')::uuid;
  end if;
  if coalesce(p->>'tipo', '') = 'domicilio' and coalesce(trim(coalesce(p->>'direccion', v_cli.direccion)), '') = '' then
    raise exception 'Para enviar a domicilio, escribe la dirección' using errcode = '22023';
  end if;

  insert into app.pedido (negocio_id, numero, tipo, canal, cliente_id, nombre, celular, direccion, referencia,
                          costo_envio, hora_entrega, nota, creado_por)
  values (app.negocio_actual(), app.siguiente('pedido'), coalesce(p->>'tipo', 'retiro'), coalesce(p->>'canal', 'local'),
          v_cli.id, coalesce(nullif(trim(p->>'nombre'), ''), v_cli.nombre, 'Cliente'),
          coalesce(nullif(trim(p->>'celular'), ''), v_cli.celular),
          coalesce(nullif(trim(p->>'direccion'), ''), v_cli.direccion), nullif(trim(p->>'referencia'), ''),
          coalesce(round((p->>'costo_envio')::numeric, 2), 0), (p->>'hora_entrega')::timestamptz,
          nullif(trim(p->>'nota'), ''), nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p->'items') loop
    select * into v_prod from app.producto where id = (v_item->>'producto_id')::uuid and activo;
    if not found then
      raise exception 'Producto no disponible' using errcode = 'P0002';
    end if;
    if v_prod.precio is null then
      raise exception 'Ponle precio a % antes de venderlo', v_prod.nombre using errcode = '22023';
    end if;
    v_cant := round((v_item->>'cantidad')::numeric, 3);
    if v_cant is null or v_cant <= 0 then
      raise exception 'Cantidad inválida' using errcode = '22023';
    end if;
    insert into app.pedido_item (negocio_id, pedido_id, producto_id, nombre, cantidad, precio, nota)
    values (app.negocio_actual(), v_id, v_prod.id, v_prod.nombre, v_cant, v_prod.precio, nullif(left(trim(v_item->>'nota'), 120), ''));
    v_sub := v_sub + round(v_cant * v_prod.precio, 2);
  end loop;
  update app.pedido set subtotal = v_sub where id = v_id;
  return v_id;
end $$;

create or replace function app.cambiar_estado_pedido(p_pedido uuid, p_estado text, p_repartidor text default null)
returns void
language plpgsql
as $$
declare
  v app.pedido%rowtype;
begin
  perform app.exigir_modulo('M10');
  if p_estado not in ('recibido', 'preparando', 'listo', 'en_camino', 'entregado', 'cancelado') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  select * into v from app.pedido where id = p_pedido for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if v.estado in ('entregado', 'cancelado') then
    raise exception 'El pedido ya está %', v.estado using errcode = '55000';
  end if;
  if p_estado = 'cancelado' and v.venta_id is not null then
    raise exception 'El pedido ya se cobró: anula la venta desde Reportes' using errcode = '55000';
  end if;
  if p_estado = 'en_camino' and v.tipo <> 'domicilio' then
    raise exception 'Solo los pedidos a domicilio salen en camino' using errcode = '22023';
  end if;
  update app.pedido set estado = p_estado, repartidor = coalesce(nullif(trim(p_repartidor), ''), repartidor),
    actualizado_en = now() where id = p_pedido;
end $$;

create or replace function app.cobrar_pedido(p_pedido uuid, p_pagos jsonb, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  v     app.pedido%rowtype;
  r     record;
  v_items jsonb;
  v_rol text := current_setting('app.rol', true);
begin
  perform app.exigir_modulo('M10');
  select * into v from app.pedido where id = p_pedido for update;
  if not found then
    raise exception 'Pedido no encontrado' using errcode = 'P0002';
  end if;
  if v.venta_id is not null then
    raise exception 'El pedido ya se cobró' using errcode = '55000';
  end if;
  if v.estado = 'cancelado' then
    raise exception 'El pedido está cancelado' using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id)
  into v_items from app.pedido_item i where i.pedido_id = v.id;
  if v.costo_envio > 0 then
    v_items := v_items || jsonb_build_array(jsonb_build_object('producto_id', app.producto_envio(), 'cantidad', 1, 'precio', v.costo_envio));
  end if;
  perform set_config('app.rol', case when v_rol = 'cajero' then 'administrador' else v_rol end, true);
  select * into r from app.registrar_venta(v_items, p_pagos, v.cliente_id, p_comprobante, 'Pedido N.º ' || v.numero) x;
  perform set_config('app.rol', v_rol, true);
  update app.pedido set venta_id = r.venta_id, actualizado_en = now() where id = v.id;
  return query select r.venta_id, r.numero, r.total, r.vuelto;
end $$;

-- ---------- Seguridad ----------

do $$
declare
  t text;
begin
  foreach t in array array['receta', 'mesa', 'cuenta', 'cuenta_item', 'pedido', 'pedido_item'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update, delete on app.receta to alcien_app;
grant select, insert, update on app.mesa, app.cuenta, app.cuenta_item, app.pedido, app.pedido_item to alcien_app;
grant execute on all functions in schema app to alcien_app;
grant usage on all sequences in schema app to alcien_app;
