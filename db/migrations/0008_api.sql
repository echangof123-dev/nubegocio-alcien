-- 0008 · Permisos que la API necesita y limpieza de códigos vencidos

-- Si el envío por WhatsApp falla, el código recién creado se borra para no contar en el límite.
grant delete on auth.codigo_acceso to alcien_app;

-- Borra códigos y sesiones viejos. Se llama periódicamente (tarea programada o al arrancar).
create or replace function auth.limpiar()
returns void
language sql
security definer
set search_path = pg_catalog, auth
as $$
  delete from auth.codigo_acceso where creado_en < now() - interval '1 day';
  delete from auth.sesion where expira_en < now() - interval '30 days' or revocada_en < now() - interval '30 days';
$$;

revoke all on function auth.limpiar() from public;
grant execute on function auth.limpiar() to alcien_app;

-- Datos del negocio que la API muestra (sin RLS abierta: pasa por la sesión del negocio)
grant execute on all functions in schema app to alcien_app;
grant execute on all functions in schema catalogo to alcien_app;
