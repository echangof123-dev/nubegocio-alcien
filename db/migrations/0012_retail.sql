-- 0012 · Tanda 3 de módulos (tiendas y ropa): variantes (M05), listas de precios (M17),
--        series y garantías (M23) y catálogo en línea (M18).

-- ---------- Variantes (M05) ----------
-- Cada variante (talla, color…) es un producto hijo con su propio stock y código de barras.
-- El modelo (el padre) agrupa y es lo que se ve en Vender; se vende siempre una variante.

alter table app.producto add column padre_id uuid references app.producto(id) on delete cascade;
alter table app.producto add column variante text;          -- "M · Rojo"
alter table app.producto add constraint producto_variante_padre check ((padre_id is null) = (variante is null));
create index producto_padre_idx on app.producto (padre_id) where padre_id is not null;

-- p_opciones: [["S","M","L"], ["Rojo","Azul"]] → S·Rojo, S·Azul, M·Rojo… (combinaciones)
create or replace function app.crear_variantes(p_producto uuid, p_opciones jsonb, p_stock numeric default 0)
returns integer
language plpgsql
as $$
declare
  v_padre app.producto%rowtype;
  v_comb  text;
  v_n     integer := 0;
  v_id    uuid;
begin
  perform app.exigir_modulo('M05');
  perform app.exigir_no_cajero();
  select * into v_padre from app.producto where id = p_producto and padre_id is null for update;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_opciones) <> 'array' or jsonb_array_length(p_opciones) = 0 then
    raise exception 'Indica las tallas, colores u opciones' using errcode = '22023';
  end if;

  for v_comb in
    with recursive grupos as (
      select ord, array(select trim(x) from jsonb_array_elements_text(g) x where trim(x) <> '') as vals
      from jsonb_array_elements(p_opciones) with ordinality as t(g, ord)
    ), comb(ord, texto) as (
      select 0::bigint, ''::text
      union all
      select g.ord, case when c.texto = '' then v else c.texto || ' · ' || v end
      from comb c join grupos g on g.ord = c.ord + 1 cross join unnest(g.vals) v
    )
    select texto from comb where ord = (select max(ord) from grupos) and texto <> ''
  loop
    if not exists (select 1 from app.producto where padre_id = v_padre.id and variante = v_comb) then
      insert into app.producto (negocio_id, categoria_id, nombre, unidad, precio, costo, maneja_stock, iva, padre_id, variante, tipo)
      values (v_padre.negocio_id, v_padre.categoria_id, v_padre.nombre || ' · ' || v_comb, v_padre.unidad, v_padre.precio,
              v_padre.costo, true, v_padre.iva, v_padre.id, v_comb, 'venta')
      returning id into v_id;
      if coalesce(p_stock, 0) > 0 then
        perform app.mover_stock(v_id, 'inicial', p_stock, null, 'Stock inicial', v_padre.costo);
      end if;
      v_n := v_n + 1;
      if v_n > 200 then
        raise exception 'Demasiadas combinaciones (máximo 200)' using errcode = '22023';
      end if;
    end if;
  end loop;
  -- El modelo ya no lleva stock propio: lo llevan sus variantes
  update app.producto set maneja_stock = false where id = v_padre.id;
  return v_n;
end $$;

-- Cambiar el precio del modelo cambia el de las variantes que tenían el mismo precio
create or replace function app.producto_precio_a_variantes()
returns trigger
language plpgsql
as $$
begin
  if new.padre_id is null and new.precio is distinct from old.precio then
    update app.producto set precio = new.precio
    where padre_id = new.id and (precio is not distinct from old.precio);
  end if;
  return null;
end $$;

create trigger producto_precio_a_variantes after update of precio on app.producto
  for each row execute function app.producto_precio_a_variantes();

-- ---------- Listas de precios (M17) ----------

create table app.lista_precio (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) between 1 and 60),
  descuento_pct  numeric(5,2) not null default 0 check (descuento_pct between 0 and 90),   -- para todo lo que no tenga precio propio
  activa         boolean not null default true,
  unique (negocio_id, nombre)
);

create table app.lista_precio_item (
  negocio_id       uuid not null references app.negocio(id) on delete cascade,
  lista_id         uuid not null references app.lista_precio(id) on delete cascade,
  producto_id      uuid not null references app.producto(id) on delete cascade,
  desde_cantidad   numeric(12,3) not null default 1 check (desde_cantidad > 0),          -- precio por volumen
  precio           numeric(12,2) not null check (precio >= 0),
  primary key (lista_id, producto_id, desde_cantidad)
);

alter table app.cliente add column lista_precio_id uuid references app.lista_precio(id) on delete set null;

-- Precio de un producto en una lista para cierta cantidad (null si no tiene precio)
create or replace function app.precio_lista(p_producto uuid, p_lista uuid, p_cantidad numeric default 1)
returns numeric
language sql
stable
as $$
  select coalesce(
    (select i.precio from app.lista_precio_item i
     where i.lista_id = p_lista and i.producto_id = p_producto and i.desde_cantidad <= coalesce(p_cantidad, 1)
     order by i.desde_cantidad desc limit 1),
    -- Una variante sin precio propio en la lista usa el de su modelo
    (select i.precio from app.lista_precio_item i join app.producto v on v.padre_id = i.producto_id
     where i.lista_id = p_lista and v.id = p_producto and i.desde_cantidad <= coalesce(p_cantidad, 1)
     order by i.desde_cantidad desc limit 1),
    (select round(p.precio * (1 - l.descuento_pct / 100), 2)
     from app.producto p, app.lista_precio l where p.id = p_producto and l.id = p_lista and l.activa));
$$;

-- Venta con lista de precios: los precios los pone la lista (el cajero puede usarla).
create or replace function app.registrar_venta_lista(
  p_items jsonb, p_pagos jsonb, p_cliente uuid, p_comprobante text, p_nota text, p_lista uuid)
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  v_rol   text := current_setting('app.rol', true);
  v_items jsonb := '[]';
  v_item  jsonb;
  v_precio numeric;
  r record;
begin
  perform app.exigir_modulo('M17');
  if not exists (select 1 from app.lista_precio where id = p_lista and activa) then
    raise exception 'Lista de precios no encontrada' using errcode = 'P0002';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_precio := app.precio_lista((v_item->>'producto_id')::uuid, p_lista, (v_item->>'cantidad')::numeric);
    if v_precio is null then
      raise exception 'Hay un producto sin precio' using errcode = '22023';
    end if;
    if v_item ? 'descuento' and (v_item->>'descuento')::numeric > 0 and v_rol = 'cajero' then
      raise exception 'Solo el dueño o un administrador pueden hacer descuentos' using errcode = '42501';
    end if;
    v_items := v_items || jsonb_build_array(v_item || jsonb_build_object('precio', v_precio));
  end loop;
  perform set_config('app.rol', case when v_rol = 'cajero' then 'administrador' else v_rol end, true);
  select * into r from app.registrar_venta(v_items, p_pagos, p_cliente, p_comprobante,
    coalesce(p_nota || ' · ', '') || 'Lista: ' || (select nombre from app.lista_precio where id = p_lista)) x;
  perform set_config('app.rol', v_rol, true);
  return query select r.venta_id, r.numero, r.total, r.vuelto;
end $$;

-- ---------- Series y garantías (M23) ----------

alter table app.producto add column garantia_meses smallint check (garantia_meses is null or garantia_meses between 0 and 120);

create table app.serie (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  producto_id     uuid not null references app.producto(id) on delete cascade,
  serie           text not null check (length(trim(serie)) between 1 and 60),
  estado          text not null default 'en_stock' check (estado in ('en_stock', 'vendida', 'devuelta')),
  venta_id        uuid references app.venta(id),
  cliente_id      uuid references app.cliente(id),
  vendida_en      date,
  garantia_hasta  date,
  nota            text,
  creado_en       timestamptz not null default now(),
  unique (negocio_id, producto_id, serie)
);
create index serie_buscar_idx on app.serie (negocio_id, serie);

-- Anota qué serie se llevó el cliente en una venta y calcula la garantía
create or replace function app.vender_serie(p_venta uuid, p_producto uuid, p_serie text)
returns app.serie
language plpgsql
as $$
declare
  v app.venta%rowtype;
  s app.serie%rowtype;
  v_meses smallint;
begin
  perform app.exigir_modulo('M23');
  select * into v from app.venta where id = p_venta and estado = 'completada';
  if not found then
    raise exception 'Venta no encontrada' using errcode = 'P0002';
  end if;
  if not exists (select 1 from app.venta_detalle where venta_id = p_venta and producto_id = p_producto) then
    raise exception 'Ese producto no está en la venta' using errcode = '22023';
  end if;
  select garantia_meses into v_meses from app.producto where id = p_producto;
  select * into s from app.serie where producto_id = p_producto and serie = trim(p_serie) for update;
  if found and s.estado = 'vendida' then
    raise exception 'La serie % ya se vendió', trim(p_serie) using errcode = '23505';
  end if;
  if not found then   -- serie que no estaba registrada: se anota al venderla
    insert into app.serie (negocio_id, producto_id, serie) values (v.negocio_id, p_producto, trim(p_serie)) returning * into s;
  end if;
  update app.serie set estado = 'vendida', venta_id = v.id, cliente_id = v.cliente_id,
    vendida_en = (v.creado_en at time zone 'America/Guayaquil')::date,
    garantia_hasta = case when coalesce(v_meses, 0) > 0
                          then (v.creado_en at time zone 'America/Guayaquil')::date + make_interval(months => v_meses) end
  where id = s.id returning * into s;
  return s;
end $$;

-- Si se anula la venta, la serie vuelve al stock
create or replace function app.venta_anulada_devolver_series()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    update app.serie set estado = 'en_stock', venta_id = null, cliente_id = null, vendida_en = null, garantia_hasta = null
    where venta_id = new.id;
  end if;
  return null;
end $$;

create trigger venta_anulada_devolver_series after update of estado on app.venta
  for each row execute function app.venta_anulada_devolver_series();

-- ---------- Catálogo en línea (M18) ----------

create table app.catalogo_config (
  negocio_id        uuid primary key references app.negocio(id) on delete cascade,
  slug              text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$'),
  activo            boolean not null default true,
  whatsapp          text,                  -- a dónde llegan los pedidos (E.164 sin +)
  mensaje           text,                  -- bienvenida
  mostrar_agotados  boolean not null default false,
  acepta_pedidos    boolean not null default true,
  costo_envio       numeric(12,2) check (costo_envio is null or costo_envio >= 0),
  actualizado_en    timestamptz not null default now()
);

create table app.catalogo_oculto (
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  producto_id  uuid not null references app.producto(id) on delete cascade,
  primary key (negocio_id, producto_id)
);

-- Datos públicos del catálogo (sin sesión)
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

-- Pedido desde el catálogo: entra como pedido (canal catálogo) al negocio
create or replace function app.catalogo_pedido(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
declare
  v_neg uuid;
  v_cc  app.catalogo_config%rowtype;
  v_id  uuid;
  v_item jsonb;
  v_items jsonb := '[]';
begin
  select * into v_cc from app.catalogo_config cc where cc.slug = lower(p_slug) and cc.activo
    and exists (select 1 from app.negocio_modulo nm where nm.negocio_id = cc.negocio_id and nm.modulo = 'M18' and nm.activo);
  if not found or not v_cc.acepta_pedidos then
    raise exception 'Este catálogo no recibe pedidos' using errcode = 'P0002';
  end if;
  v_neg := v_cc.negocio_id;
  if not exists (select 1 from app.negocio_modulo where negocio_id = v_neg and modulo = 'M10' and activo) then
    raise exception 'Este catálogo no recibe pedidos' using errcode = 'P0002';
  end if;
  if coalesce(trim(p->>'nombre'), '') = '' or coalesce(trim(p->>'celular'), '') = '' then
    raise exception 'Escribe tu nombre y tu celular' using errcode = '22023';
  end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 or jsonb_array_length(p->'items') > 50 then
    raise exception 'El pedido no tiene productos' using errcode = '22023';
  end if;
  -- Solo productos visibles del catálogo de este negocio
  for v_item in select * from jsonb_array_elements(p->'items') loop
    if not exists (select 1 from app.producto pr where pr.id = (v_item->>'producto_id')::uuid and pr.negocio_id = v_neg
                   and pr.activo and pr.precio is not null and pr.tipo = 'venta'
                   and not exists (select 1 from app.catalogo_oculto o where o.producto_id = coalesce(pr.padre_id, pr.id))) then
      raise exception 'Un producto ya no está disponible' using errcode = '22023';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'producto_id', v_item->>'producto_id',
      'cantidad', least(greatest(coalesce((v_item->>'cantidad')::numeric, 1), 1), 999),
      'nota', left(v_item->>'nota', 120)));
  end loop;

  perform set_config('app.negocio_id', v_neg::text, true);
  perform set_config('app.rol', 'catalogo', true);
  perform set_config('app.usuario_id', '', true);
  v_id := app.crear_pedido(jsonb_build_object(
    'tipo', case when p->>'tipo' = 'domicilio' then 'domicilio' else 'retiro' end, 'canal', 'catalogo',
    'nombre', left(trim(p->>'nombre'), 120), 'celular', left(trim(p->>'celular'), 20),
    'direccion', left(trim(p->>'direccion'), 300), 'referencia', left(trim(p->>'referencia'), 200),
    'costo_envio', case when p->>'tipo' = 'domicilio' then coalesce(v_cc.costo_envio, 0) else 0 end,
    'nota', left(trim(p->>'nota'), 300), 'items', v_items));
  perform set_config('app.negocio_id', '', true);
  perform set_config('app.rol', '', true);
  return (select jsonb_build_object('numero', numero, 'total', subtotal + costo_envio) from app.pedido where id = v_id);
end $$;

-- ---------- Seguridad ----------

do $$
declare
  t text;
begin
  foreach t in array array['lista_precio', 'lista_precio_item', 'serie', 'catalogo_config', 'catalogo_oculto'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update on app.lista_precio, app.serie, app.catalogo_config to alcien_app;
grant select, insert, update, delete on app.lista_precio_item, app.catalogo_oculto to alcien_app;
revoke all on function app.catalogo_publico(text), app.catalogo_pedido(text, jsonb) from public;
grant execute on all functions in schema app to alcien_app;
