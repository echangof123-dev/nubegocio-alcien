-- Módulos visibles según familia y plan; prender y apagar módulos.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000c1', '+593990000031'),
  ('00000000-0000-0000-0000-0000000000c2', '+593990000032');

create temp table ids (negocio uuid);
grant select on ids to alcien_app;
insert into ids values (app.crear_negocio('00000000-0000-0000-0000-0000000000c1', 'T045', 'Tienda C'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-0000000000c2', negocio, 'cajero' from ids;

create function pg_temp.estado(p text) returns text language sql as $$
  select estado from app.modulos_visibles() where modulo = p;
$$;
grant execute on function pg_temp.estado(text) to alcien_app;

set local role alcien_app;

do $$
declare
  v uuid := (select negocio from ids);
begin
  perform app.entrar_negocio('00000000-0000-0000-0000-0000000000c1', v);

  -- En la prueba (plan Negocio)
  assert pg_temp.estado('M01') = 'activo', 'ventas activo';
  assert pg_temp.estado('M19') = 'activo', 'SRI activo en plan Negocio';
  assert pg_temp.estado('M16') = 'bloqueado', 'lotes: de la familia, pero solo en Pro';
  assert (select plan_requerido from app.modulos_visibles() where modulo = 'M16') = 'pro', 'lotes pide Pro';
  assert pg_temp.estado('M17') = 'sugerido', 'listas de precios: sugerido';
  assert pg_temp.estado('M09') is null, 'mesas no aparece en una tienda';

  -- Activar un sugerido
  perform app.activar_modulo('M17');
  assert pg_temp.estado('M17') = 'bloqueado', 'activado pero su plan es Pro';
  assert (select origen from app.modulos_visibles() where modulo = 'M17') = 'usuario', 'origen: usuario';

  -- No se apaga lo que otro necesita, ni el núcleo
  begin
    perform app.desactivar_modulo('M04');
    assert false, 'inventario no se apaga con venta por peso prendida';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform app.desactivar_modulo('M01');
    assert false, 'ventas es núcleo';
  exception when invalid_parameter_value then null;
  end;

  -- Apagar en orden sí funciona
  perform app.desactivar_modulo('M17');
  assert pg_temp.estado('M17') is null or pg_temp.estado('M17') = 'sugerido', 'M17 apagado vuelve a sugerido o desaparece';
end $$;

-- Un cajero no cambia módulos
do $$
declare
  v uuid := (select negocio from ids);
begin
  perform app.entrar_negocio('00000000-0000-0000-0000-0000000000c2', v);
  begin
    perform app.activar_modulo('M17');
    assert false, 'un cajero no activa módulos';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Suscripción vencida: baja a Gratis sin borrar nada
update app.suscripcion set estado = 'vencida' where negocio_id = (select negocio from ids);
set local role alcien_app;

do $$
declare
  v uuid := (select negocio from ids);
begin
  perform app.entrar_negocio('00000000-0000-0000-0000-0000000000c1', v);
  assert app.plan_vigente(v) = 'gratis', 'vencida = Gratis';
  assert pg_temp.estado('M01') = 'activo', 'sigue vendiendo';
  assert pg_temp.estado('M14') = 'activo', 'sigue con fiado';
  assert pg_temp.estado('M04') = 'bloqueado', 'inventario bloqueado, no borrado';
  assert pg_temp.estado('M19') = 'bloqueado', 'SRI bloqueado';
  assert (select count(*) from app.producto) > 0, 'los productos siguen ahí';
end $$;

reset role;
rollback;
