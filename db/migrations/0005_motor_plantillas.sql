-- 0005 · Motor de plantillas: el alta automática
--
-- app.crear_negocio() convierte "¿qué negocio tienes?" en un negocio listo para vender:
--   1. crea el negocio, la prueba de 14 días del plan Negocio y la membresía de dueño;
--   2. activa los módulos núcleo y los de la familia (S), deja sugeridos los opcionales (O)
--      y activa lo que esos módulos necesitan (dependencias);
--   3. copia vocabulario, unidad, categorías y productos de ejemplo del tipo de negocio.
-- Todo en una sola transacción: o queda completo o no queda nada.

create or replace function app.crear_negocio(
  p_usuario      uuid,
  p_tipo_codigo  text,
  p_nombre       text,
  p_ruc          text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, app, catalogo, auth
as $$
declare
  v_tipo     catalogo.tipo_negocio%rowtype;
  v_familia  catalogo.familia%rowtype;
  v_negocio  uuid;
begin
  if not exists (select 1 from auth.usuario where id = p_usuario) then
    raise exception 'Usuario no encontrado' using errcode = 'P0002';
  end if;

  select * into v_tipo from catalogo.tipo_negocio
  where codigo = p_tipo_codigo and estado in ('aprobado', 'pendiente');
  if not found then
    raise exception 'Tipo de negocio no disponible: %', p_tipo_codigo using errcode = 'P0002';
  end if;

  select * into v_familia from catalogo.familia where codigo = v_tipo.familia;

  insert into app.negocio (nombre, tipo_negocio_id, familia, version_plantilla, ruc, creado_por)
  values (trim(p_nombre), v_tipo.id, v_tipo.familia, v_tipo.version, nullif(trim(p_ruc), ''), p_usuario)
  returning id into v_negocio;

  -- Deja el contexto listo para el resto de la transacción de quien llama.
  perform set_config('app.negocio_id', v_negocio::text, true);
  perform set_config('app.usuario_id', p_usuario::text, true);
  perform set_config('app.rol', 'dueno', true);

  insert into app.suscripcion (negocio_id, plan, estado, vence_en)
  values (v_negocio, 'negocio', 'prueba', now() + interval '14 days');

  insert into app.membresia (usuario_id, negocio_id, rol)
  values (p_usuario, v_negocio, 'dueno');

  -- Módulos: núcleo + los de la familia
  insert into app.negocio_modulo (negocio_id, modulo, activo, origen)
  select v_negocio, m.codigo, true, 'plantilla'
  from catalogo.modulo m
  where m.tipo = 'nucleo'
     or exists (select 1 from catalogo.familia_modulo fm
                where fm.familia = v_tipo.familia and fm.modulo = m.codigo and fm.modo = 'S');

  -- Dependencias de lo activado (en cadena)
  insert into app.negocio_modulo (negocio_id, modulo, activo, origen)
  with recursive necesarios(modulo) as (
    select d.requiere
    from app.negocio_modulo nm
    join catalogo.modulo_dependencia d on d.modulo = nm.modulo
    where nm.negocio_id = v_negocio and nm.activo
    union
    select d.requiere
    from necesarios n
    join catalogo.modulo_dependencia d on d.modulo = n.modulo
  )
  select v_negocio, n.modulo, true, 'dependencia'
  from necesarios n
  on conflict (negocio_id, modulo) do nothing;

  -- Opcionales: quedan sugeridos, apagados
  insert into app.negocio_modulo (negocio_id, modulo, activo, origen)
  select v_negocio, fm.modulo, false, 'sugerido'
  from catalogo.familia_modulo fm
  where fm.familia = v_tipo.familia and fm.modo = 'O'
  on conflict (negocio_id, modulo) do nothing;

  -- Configuración
  insert into app.negocio_config (negocio_id, palabra_items, unidad_defecto)
  values (v_negocio,
          coalesce(v_tipo.palabra_items, v_familia.palabra_items),
          coalesce(v_tipo.unidad, v_familia.unidad_defecto));

  -- Categorías del tipo, en su orden
  insert into app.categoria (negocio_id, nombre, orden)
  select v_negocio, trim(c.nombre), c.orden
  from unnest(v_tipo.categorias) with ordinality as c(nombre, orden)
  where trim(c.nombre) <> ''
  on conflict (negocio_id, nombre) do nothing;

  -- Categorías que solo aparecen en la ficha de productos
  insert into app.categoria (negocio_id, nombre, orden)
  select v_negocio, pp.categoria, 100 + min(pp.orden)
  from catalogo.plantilla_producto pp
  where pp.tipo_negocio_id = v_tipo.id
  group by pp.categoria
  on conflict (negocio_id, nombre) do nothing;

  -- Productos de ejemplo (sin precio)
  insert into app.producto (negocio_id, categoria_id, nombre, unidad, variantes, maneja_stock, es_ejemplo)
  select v_negocio, c.id, pp.nombre, pp.unidad, pp.variantes,
         lower(pp.unidad) not in ('servicio', 'plato', 'porción', 'vaso', 'hora', 'sesión'),
         true
  from catalogo.plantilla_producto pp
  join app.categoria c on c.negocio_id = v_negocio and c.nombre = pp.categoria
  where pp.tipo_negocio_id = v_tipo.id
  order by pp.orden;

  return v_negocio;
end $$;

revoke all on function app.crear_negocio(uuid, text, text, text) from public;
grant execute on function app.crear_negocio(uuid, text, text, text) to alcien_app;


-- Plan que rige hoy: una suscripción vencida baja a Gratis sin borrar nada.
create or replace function app.plan_vigente(p_negocio uuid)
returns text
language sql
stable
as $$
  select case when s.estado = 'vencida' then 'gratis' else s.plan end
  from app.suscripcion s
  where s.negocio_id = p_negocio;
$$;

grant execute on function app.plan_vigente(uuid) to alcien_app;


-- Qué módulos ve el negocio actual y en qué estado:
--   activo    → prendido y el plan lo incluye
--   bloqueado → prendido, pero el plan no lo incluye (se muestra con candado)
--   sugerido  → opcional de su familia, apagado
create or replace function app.modulos_visibles()
returns table (
  modulo          text,
  nombre          text,
  estado          text,
  plan_requerido  text,
  origen          text
)
language sql
stable
as $$
  with plan_actual as (
    select app.plan_vigente(app.negocio_actual()) as plan
  )
  select
    nm.modulo,
    m.nombre,
    case
      when not nm.activo then 'sugerido'
      when exists (select 1 from catalogo.plan_modulo pm, plan_actual pa
                   where pm.plan = pa.plan and pm.modulo = nm.modulo) then 'activo'
      else 'bloqueado'
    end,
    (select p.codigo from catalogo.plan p
     join catalogo.plan_modulo pm on pm.plan = p.codigo and pm.modulo = nm.modulo
     order by p.orden limit 1),
    nm.origen
  from app.negocio_modulo nm
  join catalogo.modulo m on m.codigo = nm.modulo
  where nm.negocio_id = app.negocio_actual()
    and (nm.activo or nm.origen = 'sugerido')
  order by m.codigo;
$$;

grant execute on function app.modulos_visibles() to alcien_app;


-- Prender un módulo (y lo que necesita). Solo dueño o administrador.
create or replace function app.activar_modulo(p_modulo text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, catalogo
as $$
declare
  v_negocio uuid := app.negocio_actual();
begin
  if v_negocio is null then
    raise exception 'Sin negocio en contexto' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pueden cambiar módulos' using errcode = '42501';
  end if;
  if not exists (select 1 from catalogo.modulo where codigo = p_modulo) then
    raise exception 'Módulo desconocido: %', p_modulo using errcode = 'P0002';
  end if;

  insert into app.negocio_modulo (negocio_id, modulo, activo, origen)
  values (v_negocio, p_modulo, true, 'usuario')
  on conflict (negocio_id, modulo) do update
    set activo = true, origen = 'usuario', actualizado_en = now();

  insert into app.negocio_modulo (negocio_id, modulo, activo, origen)
  with recursive necesarios(modulo) as (
    select requiere from catalogo.modulo_dependencia where modulo = p_modulo
    union
    select d.requiere from necesarios n join catalogo.modulo_dependencia d on d.modulo = n.modulo
  )
  select v_negocio, modulo, true, 'dependencia' from necesarios
  on conflict (negocio_id, modulo) do update
    set activo = true, actualizado_en = now()
    where not app.negocio_modulo.activo;
end $$;


-- Apagar un módulo. No se apagan los núcleo ni uno que otro módulo prendido necesita.
-- Nunca borra datos: al volver a prenderlo, todo sigue ahí.
create or replace function app.desactivar_modulo(p_modulo text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, app, catalogo
as $$
declare
  v_negocio uuid := app.negocio_actual();
  v_bloquea text;
begin
  if v_negocio is null then
    raise exception 'Sin negocio en contexto' using errcode = '42501';
  end if;
  if coalesce(current_setting('app.rol', true), '') not in ('dueno', 'administrador') then
    raise exception 'Solo el dueño o un administrador pueden cambiar módulos' using errcode = '42501';
  end if;
  if exists (select 1 from catalogo.modulo where codigo = p_modulo and tipo = 'nucleo') then
    raise exception 'El módulo % es parte del núcleo y no se puede apagar', p_modulo using errcode = '22023';
  end if;

  select string_agg(m.nombre, ', ') into v_bloquea
  from catalogo.modulo_dependencia d
  join app.negocio_modulo nm on nm.modulo = d.modulo and nm.negocio_id = v_negocio and nm.activo
  join catalogo.modulo m on m.codigo = d.modulo
  where d.requiere = p_modulo;

  if v_bloquea is not null then
    raise exception 'Primero apaga: %', v_bloquea using errcode = '22023';
  end if;

  update app.negocio_modulo
  set activo = false, actualizado_en = now()
  where negocio_id = v_negocio and modulo = p_modulo;
end $$;

revoke all on function app.activar_modulo(text), app.desactivar_modulo(text) from public;
grant execute on function app.activar_modulo(text), app.desactivar_modulo(text) to alcien_app;
