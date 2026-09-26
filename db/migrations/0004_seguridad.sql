-- 0004 · Seguridad por fila: cada negocio solo ve sus propios datos
--
-- La API se conecta como alcien_app y, al empezar cada transacción, fija el negocio:
--   select set_config('app.negocio_id', '<uuid>', true);
-- Sin ese valor, las consultas no devuelven filas de ningún negocio.
-- La regla aplica a alcien_app. El dueño de las tablas (el rol de migraciones) no la usa:
-- las funciones SECURITY DEFINER de alta y cobro corren como dueño y validan permisos ellas mismas.

do $$
declare
  t text;
begin
  foreach t in array array[
    'suscripcion', 'membresia', 'negocio_modulo', 'negocio_config', 'categoria', 'producto'
  ] loop
    execute format('alter table app.%I enable row level security', t);
    execute format(
      'create policy aislamiento_negocio on app.%I
         using (negocio_id = app.negocio_actual())
         with check (negocio_id = app.negocio_actual())', t);
  end loop;
end $$;

alter table app.negocio enable row level security;
create policy aislamiento_negocio on app.negocio
  using (id = app.negocio_actual())
  with check (id = app.negocio_actual());

-- Permisos del rol de la API
grant select, update on app.negocio to alcien_app;
grant select on app.suscripcion to alcien_app;              -- solo cambia por el cobro (funciones de sistema)
grant select, insert, update on app.membresia to alcien_app;
grant select on app.negocio_modulo to alcien_app;            -- se cambia con app.activar_modulo / desactivar_modulo
grant select, update on app.negocio_config to alcien_app;
grant select, insert, update, delete on app.categoria, app.producto to alcien_app;

grant select, insert, update on auth.usuario, auth.codigo_acceso, auth.sesion to alcien_app;

-- Negocios de un usuario, para elegir con cuál trabajar antes de fijar el contexto.
create or replace function app.mis_negocios(p_usuario uuid)
returns table (negocio_id uuid, nombre text, rol text, familia text)
language sql
stable
security definer
set search_path = pg_catalog, app, auth
as $$
  select n.id, n.nombre, m.rol, n.familia
  from app.membresia m
  join app.negocio n on n.id = m.negocio_id
  where m.usuario_id = p_usuario and m.activo
  order by n.creado_en;
$$;

-- Fija el contexto solo si el usuario pertenece al negocio. Es la puerta de entrada de la API.
create or replace function app.entrar_negocio(p_usuario uuid, p_negocio uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, app, auth
as $$
declare
  v_rol text;
begin
  select m.rol into v_rol
  from app.membresia m
  where m.usuario_id = p_usuario and m.negocio_id = p_negocio and m.activo;

  if v_rol is null then
    raise exception 'El usuario no pertenece a este negocio' using errcode = '42501';
  end if;

  perform set_config('app.negocio_id', p_negocio::text, true);
  perform set_config('app.usuario_id', p_usuario::text, true);
  perform set_config('app.rol', v_rol, true);
  return v_rol;
end $$;

revoke all on function app.mis_negocios(uuid), app.entrar_negocio(uuid, uuid) from public;
grant execute on function app.mis_negocios(uuid), app.entrar_negocio(uuid, uuid) to alcien_app;
