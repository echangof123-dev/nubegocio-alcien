-- 0013 · Tanda 4 de módulos (servicios): citas y agenda (M11), servicios y comisiones (M12),
--        órdenes de trabajo (M13), reservas por fecha (M26) y membresías (M22).

-- ---------- Profesionales (quien atiende: estilista, técnico, entrenador…) ----------

create table app.profesional (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) between 1 and 80),
  celular        text,
  usuario_id     uuid references auth.usuario(id),
  comision_pct   numeric(5,2) not null default 0 check (comision_pct between 0 and 100),
  color          text not null default '#1847c2' check (color ~ '^#[0-9a-fA-F]{6}$'),
  activo         boolean not null default true,
  unique (negocio_id, nombre)
);

-- Servicios: productos con duración y, si se quiere, su propia comisión
alter table app.producto add column duracion_min smallint check (duracion_min is null or duracion_min between 5 and 1440);
alter table app.producto add column comision_pct numeric(5,2) check (comision_pct is null or comision_pct between 0 and 100);

-- ---------- Comisiones (M12) ----------

create table app.comision (
  id              bigint generated always as identity primary key,
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  profesional_id  uuid not null references app.profesional(id),
  venta_id        uuid not null references app.venta(id),
  producto_id     uuid references app.producto(id) on delete set null,
  descripcion     text not null,
  base            numeric(12,2) not null,           -- lo cobrado por la línea (con IVA)
  pct             numeric(5,2) not null,
  monto           numeric(12,2) not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  pagada_en       timestamptz,
  creado_en       timestamptz not null default now()
);
create index comision_profesional_idx on app.comision (negocio_id, profesional_id, estado);

-- Comisiones de una venta: por línea, con el % del servicio o, si no tiene, el del profesional
create or replace function app.registrar_comisiones(p_venta uuid, p_profesional uuid)
returns numeric
language plpgsql
as $$
declare
  v_prof app.profesional%rowtype;
  v_total numeric := 0;
begin
  if p_profesional is null or not app.modulo_activo('M12') then
    return 0;
  end if;
  select * into v_prof from app.profesional where id = p_profesional and activo;
  if not found then
    raise exception 'Profesional no encontrado' using errcode = 'P0002';
  end if;
  insert into app.comision (negocio_id, profesional_id, venta_id, producto_id, descripcion, base, pct, monto)
  select d.negocio_id, v_prof.id, d.venta_id, d.producto_id, d.nombre, d.total,
         coalesce(p.comision_pct, v_prof.comision_pct),
         round(d.total * coalesce(p.comision_pct, v_prof.comision_pct) / 100, 2)
  from app.venta_detalle d left join app.producto p on p.id = d.producto_id
  where d.venta_id = p_venta and coalesce(p.comision_pct, v_prof.comision_pct) > 0;
  select coalesce(sum(monto), 0) into v_total from app.comision where venta_id = p_venta and profesional_id = v_prof.id;
  return v_total;
end $$;

-- Pagar las comisiones pendientes de un profesional (si es en efectivo, sale de la caja)
create or replace function app.pagar_comisiones(p_profesional uuid, p_metodo text default 'efectivo')
returns numeric
language plpgsql
as $$
declare
  v_total numeric;
begin
  perform app.exigir_modulo('M12');
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pagan comisiones' using errcode = '42501';
  end if;
  with pagadas as (
    update app.comision set estado = 'pagada', pagada_en = now()
    where profesional_id = p_profesional and estado = 'pendiente'
    returning monto)
  select coalesce(sum(monto), 0) into v_total from pagadas;
  if v_total > 0 and p_metodo = 'efectivo' and app.turno_abierto() is not null then
    perform app.movimiento_caja('retiro', v_total, 'Comisiones de ' || (select nombre from app.profesional where id = p_profesional));
  end if;
  return v_total;
end $$;

create or replace function app.venta_anulada_anular_comisiones()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    update app.comision set estado = 'anulada' where venta_id = new.id and estado = 'pendiente';
  end if;
  return null;
end $$;

create trigger venta_anulada_anular_comisiones after update of estado on app.venta
  for each row execute function app.venta_anulada_anular_comisiones();

-- ---------- Citas y agenda (M11) ----------

create table app.cita (
  id              uuid primary key default gen_random_uuid(),
  negocio_id      uuid not null references app.negocio(id) on delete cascade,
  cliente_id      uuid references app.cliente(id),
  nombre          text not null,
  celular         text,
  profesional_id  uuid references app.profesional(id),
  servicio_id     uuid references app.producto(id),
  inicio          timestamptz not null,
  fin             timestamptz not null,
  estado          text not null default 'agendada' check (estado in ('agendada', 'confirmada', 'atendida', 'no_vino', 'cancelada')),
  nota            text,
  venta_id        uuid references app.venta(id),
  creado_por      uuid references auth.usuario(id),
  creado_en       timestamptz not null default now(),
  check (fin > inicio)
);
create index cita_agenda_idx on app.cita (negocio_id, inicio);

-- p: {cliente_id, nombre, celular, profesional_id, servicio_id, inicio, duracion_min, nota}
create or replace function app.agendar_cita(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_cli   app.cliente%rowtype;
  v_serv  app.producto%rowtype;
  v_ini   timestamptz := (p->>'inicio')::timestamptz;
  v_fin   timestamptz;
  v_id    uuid;
  v_prof  uuid := nullif(p->>'profesional_id', '')::uuid;
begin
  perform app.exigir_modulo('M11');
  if v_ini is null then
    raise exception 'Indica el día y la hora' using errcode = '22023';
  end if;
  if p->>'cliente_id' is not null then
    select * into v_cli from app.cliente where id = (p->>'cliente_id')::uuid;
  end if;
  if p->>'servicio_id' is not null then
    select * into v_serv from app.producto where id = (p->>'servicio_id')::uuid and activo;
  end if;
  v_fin := v_ini + make_interval(mins => coalesce((p->>'duracion_min')::int, v_serv.duracion_min, 30));
  if coalesce(trim(coalesce(p->>'nombre', v_cli.nombre)), '') = '' then
    raise exception 'Escribe el nombre del cliente' using errcode = '22023';
  end if;
  -- Un profesional no atiende dos citas a la vez
  if v_prof is not null then
    perform 1 from app.profesional where id = v_prof for update;
    if exists (select 1 from app.cita where profesional_id = v_prof and estado in ('agendada', 'confirmada')
               and tstzrange(inicio, fin) && tstzrange(v_ini, v_fin)) then
      raise exception '% ya tiene una cita a esa hora', (select nombre from app.profesional where id = v_prof) using errcode = '23P01';
    end if;
  end if;
  insert into app.cita (negocio_id, cliente_id, nombre, celular, profesional_id, servicio_id, inicio, fin, nota, creado_por)
  values (app.negocio_actual(), v_cli.id, coalesce(nullif(trim(p->>'nombre'), ''), v_cli.nombre),
          coalesce(nullif(trim(p->>'celular'), ''), v_cli.celular), v_prof, v_serv.id, v_ini, v_fin,
          nullif(trim(p->>'nota'), ''), nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.cambiar_cita(p_cita uuid, p_estado text, p_inicio timestamptz default null)
returns void
language plpgsql
as $$
declare
  c app.cita%rowtype;
  v_dur interval;
begin
  perform app.exigir_modulo('M11');
  select * into c from app.cita where id = p_cita for update;
  if not found then
    raise exception 'Cita no encontrada' using errcode = 'P0002';
  end if;
  if c.venta_id is not null then
    raise exception 'La cita ya se cobró' using errcode = '55000';
  end if;
  if p_estado not in ('agendada', 'confirmada', 'atendida', 'no_vino', 'cancelada') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if p_inicio is not null then   -- reprogramar
    v_dur := c.fin - c.inicio;
    if c.profesional_id is not null and exists (
         select 1 from app.cita where profesional_id = c.profesional_id and id <> c.id and estado in ('agendada', 'confirmada')
           and tstzrange(inicio, fin) && tstzrange(p_inicio, p_inicio + v_dur)) then
      raise exception 'Ese horario ya está ocupado' using errcode = '23P01';
    end if;
    update app.cita set inicio = p_inicio, fin = p_inicio + v_dur where id = c.id;
  end if;
  update app.cita set estado = p_estado where id = c.id;
end $$;

-- Cobrar la cita: venta del servicio (+ lo que se agregue) y comisión del profesional
create or replace function app.cobrar_cita(p_cita uuid, p_items jsonb, p_pagos jsonb, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric, comision numeric)
language plpgsql
as $$
declare
  c app.cita%rowtype;
  r record;
  v_items jsonb := coalesce(p_items, '[]');
  v_com numeric;
begin
  perform app.exigir_modulo('M11');
  select * into c from app.cita where id = p_cita for update;
  if not found then
    raise exception 'Cita no encontrada' using errcode = 'P0002';
  end if;
  if c.venta_id is not null or c.estado = 'cancelada' then
    raise exception 'Esta cita ya no se puede cobrar' using errcode = '55000';
  end if;
  if jsonb_array_length(v_items) = 0 then
    if c.servicio_id is null then
      raise exception 'Indica qué servicio se cobra' using errcode = '22023';
    end if;
    v_items := jsonb_build_array(jsonb_build_object('producto_id', c.servicio_id, 'cantidad', 1));
  end if;
  select * into r from app.registrar_venta(v_items, p_pagos, c.cliente_id, p_comprobante,
    'Cita de ' || c.nombre || coalesce(' con ' || (select nombre from app.profesional where id = c.profesional_id), '')) x;
  v_com := app.registrar_comisiones(r.venta_id, c.profesional_id);
  update app.cita set venta_id = r.venta_id, estado = 'atendida' where id = c.id;
  return query select r.venta_id, r.numero, r.total, r.vuelto, v_com;
end $$;

-- ---------- Órdenes de trabajo (M13) ----------

create table app.orden (
  id               uuid primary key default gen_random_uuid(),
  negocio_id       uuid not null references app.negocio(id) on delete cascade,
  numero           bigint not null,
  cliente_id       uuid references app.cliente(id),
  nombre           text not null,
  celular          text,
  equipo           text not null,                   -- "Moto Honda CB190", "Laptop HP 240 G8"
  identificador    text,                            -- placa, serie, IMEI
  problema         text not null,
  diagnostico      text,
  estado           text not null default 'recibida'
                   check (estado in ('recibida', 'diagnostico', 'esperando_repuesto', 'en_reparacion', 'lista', 'entregada', 'cancelada')),
  tecnico_id       uuid references app.profesional(id),
  fecha_prometida  date,
  token_publico    text not null unique default encode(gen_random_bytes(18), 'hex'),
  venta_id         uuid references app.venta(id),
  creado_por       uuid references auth.usuario(id),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (negocio_id, numero)
);
create index orden_negocio_estado_idx on app.orden (negocio_id, estado, creado_en desc);

create table app.orden_item (
  id           bigint generated always as identity primary key,
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  orden_id     uuid not null references app.orden(id) on delete cascade,
  producto_id  uuid not null references app.producto(id),
  nombre       text not null,
  tipo         text not null check (tipo in ('repuesto', 'mano_obra')),
  cantidad     numeric(12,3) not null check (cantidad > 0),
  precio       numeric(12,2) not null check (precio >= 0)
);

create table app.orden_evento (
  id          bigint generated always as identity primary key,
  negocio_id  uuid not null references app.negocio(id) on delete cascade,
  orden_id    uuid not null references app.orden(id) on delete cascade,
  estado      text not null,
  nota        text,
  creado_por  uuid references auth.usuario(id),
  creado_en   timestamptz not null default now()
);

create or replace function app.crear_orden(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_cli app.cliente%rowtype;
  v_id uuid;
begin
  perform app.exigir_modulo('M13');
  if p->>'cliente_id' is not null then
    select * into v_cli from app.cliente where id = (p->>'cliente_id')::uuid;
  end if;
  if coalesce(trim(p->>'equipo'), '') = '' or coalesce(trim(p->>'problema'), '') = '' then
    raise exception 'Describe el equipo y el problema' using errcode = '22023';
  end if;
  insert into app.orden (negocio_id, numero, cliente_id, nombre, celular, equipo, identificador, problema,
                         tecnico_id, fecha_prometida, creado_por)
  values (app.negocio_actual(), app.siguiente('orden'), v_cli.id,
          coalesce(nullif(trim(p->>'nombre'), ''), v_cli.nombre, 'Cliente'), coalesce(nullif(trim(p->>'celular'), ''), v_cli.celular),
          trim(p->>'equipo'), nullif(trim(p->>'identificador'), ''), trim(p->>'problema'),
          nullif(p->>'tecnico_id', '')::uuid, nullif(p->>'fecha_prometida', '')::date,
          nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;
  insert into app.orden_evento (negocio_id, orden_id, estado, nota, creado_por)
  values (app.negocio_actual(), v_id, 'recibida', null, nullif(current_setting('app.usuario_id', true), '')::uuid);
  return v_id;
end $$;

create or replace function app.estado_orden(p_orden uuid, p_estado text, p_nota text default null, p_diagnostico text default null)
returns void
language plpgsql
as $$
declare
  o app.orden%rowtype;
begin
  perform app.exigir_modulo('M13');
  select * into o from app.orden where id = p_orden for update;
  if not found then
    raise exception 'Orden no encontrada' using errcode = 'P0002';
  end if;
  if o.estado in ('entregada', 'cancelada') then
    raise exception 'La orden ya está %', o.estado using errcode = '55000';
  end if;
  if p_estado not in ('recibida', 'diagnostico', 'esperando_repuesto', 'en_reparacion', 'lista', 'entregada', 'cancelada') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if p_estado = 'entregada' and o.venta_id is null
     and exists (select 1 from app.orden_item where orden_id = o.id) then
    raise exception 'Cobra la orden antes de entregarla' using errcode = '55000';
  end if;
  if p_estado = 'cancelada' and o.venta_id is not null then
    raise exception 'La orden ya se cobró: anula la venta desde Reportes' using errcode = '55000';
  end if;
  update app.orden set estado = p_estado, diagnostico = coalesce(nullif(trim(p_diagnostico), ''), diagnostico), actualizado_en = now()
  where id = o.id;
  insert into app.orden_evento (negocio_id, orden_id, estado, nota, creado_por)
  values (o.negocio_id, o.id, p_estado, nullif(trim(p_nota), ''), nullif(current_setting('app.usuario_id', true), '')::uuid);
end $$;

-- p_items: [{"producto_id": uuid, "tipo": "repuesto"|"mano_obra", "cantidad": 1, "precio": 15 (opcional)}]
create or replace function app.agregar_a_orden(p_orden uuid, p_items jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_prod app.producto%rowtype;
  v_precio numeric;
begin
  perform app.exigir_modulo('M13');
  if not exists (select 1 from app.orden where id = p_orden and venta_id is null and estado not in ('entregada', 'cancelada')) then
    raise exception 'La orden ya no se puede cambiar' using errcode = '55000';
  end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from app.producto where id = (v_item->>'producto_id')::uuid and activo;
    if not found then
      raise exception 'Producto no disponible' using errcode = 'P0002';
    end if;
    v_precio := round(coalesce((v_item->>'precio')::numeric, v_prod.precio), 2);
    if v_precio is null then
      raise exception 'Indica el precio de %', v_prod.nombre using errcode = '22023';
    end if;
    if coalesce(current_setting('app.rol', true), '') = 'cajero' and v_prod.precio is not null and v_precio <> v_prod.precio then
      raise exception 'Solo el dueño o un administrador pueden cambiar precios' using errcode = '42501';
    end if;
    insert into app.orden_item (negocio_id, orden_id, producto_id, nombre, tipo, cantidad, precio)
    values (app.negocio_actual(), p_orden, v_prod.id, v_prod.nombre,
            case when v_item->>'tipo' = 'mano_obra' then 'mano_obra' else 'repuesto' end,
            round(coalesce((v_item->>'cantidad')::numeric, 1), 3), v_precio);
  end loop;
  update app.orden set actualizado_en = now() where id = p_orden;
end $$;

create or replace function app.cobrar_orden(p_orden uuid, p_pagos jsonb, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  o app.orden%rowtype;
  r record;
  v_items jsonb;
  v_rol text := current_setting('app.rol', true);
begin
  perform app.exigir_modulo('M13');
  select * into o from app.orden where id = p_orden for update;
  if not found then
    raise exception 'Orden no encontrada' using errcode = 'P0002';
  end if;
  if o.venta_id is not null or o.estado = 'cancelada' then
    raise exception 'La orden ya se cobró o está cancelada' using errcode = '55000';
  end if;
  select jsonb_agg(jsonb_build_object('producto_id', i.producto_id, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id)
  into v_items from app.orden_item i where i.orden_id = o.id;
  if v_items is null then
    raise exception 'La orden no tiene repuestos ni mano de obra' using errcode = '22023';
  end if;
  perform set_config('app.rol', case when v_rol = 'cajero' then 'administrador' else v_rol end, true);
  select * into r from app.registrar_venta(v_items, p_pagos, o.cliente_id, p_comprobante, 'Orden de trabajo N.º ' || o.numero) x;
  perform set_config('app.rol', v_rol, true);
  perform app.registrar_comisiones(r.venta_id, o.tecnico_id);
  update app.orden set venta_id = r.venta_id, actualizado_en = now() where id = o.id;
  return query select r.venta_id, r.numero, r.total, r.vuelto;
end $$;

-- Seguimiento público de la orden (enlace para el cliente)
create or replace function app.orden_publica(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, app
as $$
  select jsonb_build_object(
    'numero', o.numero, 'negocio', n.nombre, 'equipo', o.equipo, 'identificador', o.identificador, 'problema', o.problema,
    'diagnostico', o.diagnostico, 'estado', o.estado, 'fecha_prometida', o.fecha_prometida, 'recibida', o.creado_en,
    'total', (select sum(round(i.cantidad * i.precio, 2)) from app.orden_item i where i.orden_id = o.id),
    'items', (select jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'precio', i.precio) order by i.id)
              from app.orden_item i where i.orden_id = o.id),
    'historial', (select jsonb_agg(jsonb_build_object('estado', e.estado, 'nota', e.nota, 'fecha', e.creado_en) order by e.id)
                  from app.orden_evento e where e.orden_id = o.id))
  from app.orden o join app.negocio n on n.id = o.negocio_id
  where o.token_publico = p_token and length(p_token) = 36;
$$;

-- ---------- Reservas por fecha (M26) ----------

create table app.recurso (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  nombre       text not null check (length(trim(nombre)) between 1 and 80),
  tipo         text,                              -- Habitación, Cancha, Salón, Equipo…
  unidad       text not null default 'noche' check (unidad in ('noche', 'dia', 'hora')),
  precio       numeric(12,2) not null check (precio >= 0),
  capacidad    smallint,
  producto_id  uuid not null references app.producto(id),     -- lo que se cobra en la venta
  activo       boolean not null default true,
  unique (negocio_id, nombre)
);

create table app.reserva (
  id           uuid primary key default gen_random_uuid(),
  negocio_id   uuid not null references app.negocio(id) on delete cascade,
  numero       bigint not null,
  recurso_id   uuid not null references app.recurso(id),
  cliente_id   uuid references app.cliente(id),
  nombre       text not null,
  celular      text,
  desde        timestamptz not null,
  hasta        timestamptz not null,
  unidades     numeric(12,3) not null,            -- noches, días u horas
  precio       numeric(12,2) not null,            -- por unidad
  total        numeric(12,2) not null,
  estado       text not null default 'reservada' check (estado in ('reservada', 'confirmada', 'en_curso', 'finalizada', 'cancelada')),
  personas     smallint,
  nota         text,
  venta_id     uuid references app.venta(id),
  creado_por   uuid references auth.usuario(id),
  creado_en    timestamptz not null default now(),
  unique (negocio_id, numero),
  check (hasta > desde)
);
create index reserva_recurso_idx on app.reserva (recurso_id, desde);

create or replace function app.crear_recurso(p_nombre text, p_tipo text, p_unidad text, p_precio numeric, p_capacidad integer default null)
returns uuid
language plpgsql
as $$
declare
  v_prod uuid;
  v_id uuid;
begin
  perform app.exigir_modulo('M26');
  perform app.exigir_no_cajero();
  insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock)
  values (app.negocio_actual(), 'Reserva: ' || trim(p_nombre), initcap(coalesce(p_unidad, 'noche')), p_precio, false)
  returning id into v_prod;
  insert into app.recurso (negocio_id, nombre, tipo, unidad, precio, capacidad, producto_id)
  values (app.negocio_actual(), trim(p_nombre), nullif(trim(p_tipo), ''), coalesce(p_unidad, 'noche'), p_precio, p_capacidad, v_prod)
  returning id into v_id;
  return v_id;
end $$;

-- p: {recurso_id, cliente_id, nombre, celular, desde, hasta, personas, nota, precio (opcional)}
create or replace function app.reservar(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_rec app.recurso%rowtype;
  v_cli app.cliente%rowtype;
  v_desde timestamptz := (p->>'desde')::timestamptz;
  v_hasta timestamptz := (p->>'hasta')::timestamptz;
  v_unid numeric;
  v_precio numeric;
  v_id uuid;
begin
  perform app.exigir_modulo('M26');
  select * into v_rec from app.recurso where id = (p->>'recurso_id')::uuid and activo for update;
  if not found then
    raise exception 'No encontramos eso que quieres reservar' using errcode = 'P0002';
  end if;
  if v_desde is null or v_hasta is null or v_hasta <= v_desde then
    raise exception 'Revisa las fechas' using errcode = '22023';
  end if;
  if exists (select 1 from app.reserva where recurso_id = v_rec.id and estado in ('reservada', 'confirmada', 'en_curso')
             and tstzrange(desde, hasta) && tstzrange(v_desde, v_hasta)) then
    raise exception '% ya está reservado en esas fechas', v_rec.nombre using errcode = '23P01';
  end if;
  if p->>'cliente_id' is not null then
    select * into v_cli from app.cliente where id = (p->>'cliente_id')::uuid;
  end if;
  v_unid := case v_rec.unidad
              when 'hora' then ceil(extract(epoch from v_hasta - v_desde) / 3600)
              else greatest(1, (v_hasta at time zone 'America/Guayaquil')::date - (v_desde at time zone 'America/Guayaquil')::date
                                 + case when v_rec.unidad = 'dia' then 1 else 0 end) end;
  v_precio := round(coalesce((p->>'precio')::numeric, v_rec.precio), 2);
  if v_precio <> v_rec.precio and coalesce(current_setting('app.rol', true), '') = 'cajero' then
    raise exception 'Solo el dueño o un administrador pueden cambiar precios' using errcode = '42501';
  end if;
  insert into app.reserva (negocio_id, numero, recurso_id, cliente_id, nombre, celular, desde, hasta, unidades, precio, total,
                           personas, nota, creado_por)
  values (app.negocio_actual(), app.siguiente('reserva'), v_rec.id, v_cli.id,
          coalesce(nullif(trim(p->>'nombre'), ''), v_cli.nombre, 'Cliente'), coalesce(nullif(trim(p->>'celular'), ''), v_cli.celular),
          v_desde, v_hasta, v_unid, v_precio, round(v_unid * v_precio, 2), nullif(p->>'personas', '')::smallint,
          nullif(trim(p->>'nota'), ''), nullif(current_setting('app.usuario_id', true), '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

create or replace function app.estado_reserva(p_reserva uuid, p_estado text)
returns void
language plpgsql
as $$
begin
  perform app.exigir_modulo('M26');
  if p_estado not in ('reservada', 'confirmada', 'en_curso', 'finalizada', 'cancelada') then
    raise exception 'Estado inválido' using errcode = '22023';
  end if;
  if p_estado = 'cancelada' and exists (select 1 from app.reserva where id = p_reserva and venta_id is not null) then
    raise exception 'La reserva ya se cobró: anula la venta desde Reportes' using errcode = '55000';
  end if;
  update app.reserva set estado = p_estado where id = p_reserva and estado not in ('finalizada', 'cancelada');
  if not found then
    raise exception 'La reserva ya está cerrada' using errcode = '55000';
  end if;
end $$;

create or replace function app.cobrar_reserva(p_reserva uuid, p_pagos jsonb, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric)
language plpgsql
as $$
declare
  v app.reserva%rowtype;
  r record;
  v_rol text := current_setting('app.rol', true);
begin
  perform app.exigir_modulo('M26');
  select * into v from app.reserva where id = p_reserva for update;
  if not found or v.venta_id is not null or v.estado = 'cancelada' then
    raise exception 'Esta reserva no se puede cobrar' using errcode = '55000';
  end if;
  perform set_config('app.rol', case when v_rol = 'cajero' then 'administrador' else v_rol end, true);
  select * into r from app.registrar_venta(
    jsonb_build_array(jsonb_build_object('producto_id', (select producto_id from app.recurso where id = v.recurso_id),
                                         'cantidad', v.unidades, 'precio', v.precio)),
    p_pagos, v.cliente_id, p_comprobante, 'Reserva N.º ' || v.numero) x;
  perform set_config('app.rol', v_rol, true);
  update app.reserva set venta_id = r.venta_id where id = v.id;
  return query select r.venta_id, r.numero, r.total, r.vuelto;
end $$;

-- ---------- Membresías (M22) ----------

create table app.plan_membresia (
  id             uuid primary key default gen_random_uuid(),
  negocio_id     uuid not null references app.negocio(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) between 1 and 80),
  precio         numeric(12,2) not null check (precio >= 0),
  duracion_dias  integer not null check (duracion_dias between 1 and 3660),
  sesiones       integer check (sesiones is null or sesiones > 0),     -- null = ilimitado
  producto_id    uuid not null references app.producto(id),
  activo         boolean not null default true,
  unique (negocio_id, nombre)
);

create table app.membresia_cliente (
  id                  uuid primary key default gen_random_uuid(),
  negocio_id          uuid not null references app.negocio(id) on delete cascade,
  cliente_id          uuid not null references app.cliente(id),
  plan_id             uuid not null references app.plan_membresia(id),
  desde               date not null,
  hasta               date not null,
  sesiones_restantes  integer,
  estado              text not null default 'activa' check (estado in ('activa', 'anulada')),
  venta_id            uuid references app.venta(id),
  creado_en           timestamptz not null default now()
);
create index membresia_cliente_idx on app.membresia_cliente (negocio_id, cliente_id, hasta desc);

create table app.asistencia (
  id            bigint generated always as identity primary key,
  negocio_id    uuid not null references app.negocio(id) on delete cascade,
  membresia_id  uuid not null references app.membresia_cliente(id) on delete cascade,
  cliente_id    uuid not null references app.cliente(id),
  creado_por    uuid references auth.usuario(id),
  creado_en     timestamptz not null default now()
);
create index asistencia_fecha_idx on app.asistencia (negocio_id, creado_en desc);

create or replace function app.crear_plan_membresia(p_nombre text, p_precio numeric, p_dias integer, p_sesiones integer default null)
returns uuid
language plpgsql
as $$
declare
  v_prod uuid;
  v_id uuid;
begin
  perform app.exigir_modulo('M22');
  perform app.exigir_no_cajero();
  insert into app.producto (negocio_id, nombre, unidad, precio, maneja_stock)
  values (app.negocio_actual(), 'Membresía: ' || trim(p_nombre), 'Servicio', p_precio, false)
  returning id into v_prod;
  insert into app.plan_membresia (negocio_id, nombre, precio, duracion_dias, sesiones, producto_id)
  values (app.negocio_actual(), trim(p_nombre), p_precio, p_dias, p_sesiones, v_prod)
  returning id into v_id;
  return v_id;
end $$;

-- Vender (o renovar) una membresía: si todavía está vigente, la nueva empieza cuando termina la actual
create or replace function app.vender_membresia(p_cliente uuid, p_plan uuid, p_pagos jsonb, p_comprobante text default 'nota')
returns table (venta_id uuid, numero bigint, total numeric, vuelto numeric, membresia_id uuid, hasta date)
language plpgsql
as $$
declare
  pl app.plan_membresia%rowtype;
  r record;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_desde date;
  v_id uuid;
begin
  perform app.exigir_modulo('M22');
  select * into pl from app.plan_membresia where id = p_plan and activo;
  if not found then
    raise exception 'Plan no encontrado' using errcode = 'P0002';
  end if;
  if not exists (select 1 from app.cliente where id = p_cliente) then
    raise exception 'Elige el cliente' using errcode = '22023';
  end if;
  select greatest(v_hoy, coalesce(max(m.hasta) + 1, v_hoy)) into v_desde
  from app.membresia_cliente m where m.cliente_id = p_cliente and m.estado = 'activa' and m.hasta >= v_hoy;
  select * into r from app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', pl.producto_id, 'cantidad', 1)),
    p_pagos, p_cliente, p_comprobante, 'Membresía ' || pl.nombre) x;
  insert into app.membresia_cliente (negocio_id, cliente_id, plan_id, desde, hasta, sesiones_restantes, venta_id)
  values (app.negocio_actual(), p_cliente, pl.id, v_desde, v_desde + pl.duracion_dias - 1, pl.sesiones, r.venta_id)
  returning id into v_id;
  return query select r.venta_id, r.numero, r.total, r.vuelto, v_id, v_desde + pl.duracion_dias - 1;
end $$;

-- Marcar la entrada del cliente: usa la membresía vigente (y descuenta una sesión si tiene límite)
create or replace function app.registrar_asistencia(p_cliente uuid)
returns jsonb
language plpgsql
as $$
declare
  m app.membresia_cliente%rowtype;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
begin
  perform app.exigir_modulo('M22');
  select * into m from app.membresia_cliente
  where cliente_id = p_cliente and estado = 'activa' and v_hoy between desde and hasta
    and (sesiones_restantes is null or sesiones_restantes > 0)
  order by hasta limit 1 for update;
  if not found then
    raise exception 'No tiene una membresía vigente' using errcode = '55000';
  end if;
  update app.membresia_cliente set sesiones_restantes = sesiones_restantes - 1 where id = m.id and sesiones_restantes is not null;
  insert into app.asistencia (negocio_id, membresia_id, cliente_id, creado_por)
  values (m.negocio_id, m.id, p_cliente, nullif(current_setting('app.usuario_id', true), '')::uuid);
  return jsonb_build_object('hasta', m.hasta, 'sesiones_restantes', case when m.sesiones_restantes is null then null else m.sesiones_restantes - 1 end);
end $$;

create or replace function app.venta_anulada_anular_membresia()
returns trigger
language plpgsql
as $$
begin
  if new.estado = 'anulada' and old.estado <> 'anulada' then
    update app.membresia_cliente set estado = 'anulada' where venta_id = new.id;
  end if;
  return null;
end $$;

create trigger venta_anulada_anular_membresia after update of estado on app.venta
  for each row execute function app.venta_anulada_anular_membresia();

-- ---------- Seguridad ----------

do $$
declare
  t text;
begin
  foreach t in array array['profesional', 'comision', 'cita', 'orden', 'orden_item', 'orden_evento', 'recurso', 'reserva',
                           'plan_membresia', 'membresia_cliente', 'asistencia'] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

grant select, insert, update on app.profesional, app.comision, app.cita, app.orden, app.recurso, app.reserva,
  app.plan_membresia, app.membresia_cliente to alcien_app;
grant select, insert, update, delete on app.orden_item to alcien_app;
grant select, insert on app.orden_evento, app.asistencia to alcien_app;
revoke all on function app.orden_publica(text) from public;
grant execute on all functions in schema app to alcien_app;
