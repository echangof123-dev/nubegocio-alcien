-- Permisos por empleado: el cajero sin permisos no cambia precios ni anula; con permisos, sí.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-000000000201', '+593990000131'),
  ('00000000-0000-0000-0000-000000000202', '+593990000132'),
  ('00000000-0000-0000-0000-000000000203', '+593990000133');

create temp table ids (clave text primary key, id uuid);
grant select, insert, update on ids to alcien_app;
insert into ids values ('neg', app.crear_negocio('00000000-0000-0000-0000-000000000201', 'T061', 'Permisos P'));
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-000000000202', id, 'cajero' from ids where clave = 'neg';
insert into app.membresia (usuario_id, negocio_id, rol)
select '00000000-0000-0000-0000-000000000203', id, 'bodeguero' from ids where clave = 'neg';

create function pg_temp.entrar(u text) returns void language sql as $$
  select app.entrar_negocio(u::uuid, (select id from ids where clave = 'neg'));
$$;
grant execute on function pg_temp.entrar(text) to alcien_app;

-- Un permiso que no existe no se guarda
do $$
begin
  begin
    update app.membresia set permisos = array['todo'] where usuario_id = '00000000-0000-0000-0000-000000000202';
    assert false, 'permiso desconocido';
  exception when check_violation then null;
  end;
end $$;

select set_config('app.negocio_id', '', true);
set local role alcien_app;

do $$
declare
  p uuid; r record;
begin
  perform pg_temp.entrar('00000000-0000-0000-0000-000000000201');
  perform app.abrir_caja(0);
  insert into app.producto (negocio_id, nombre, unidad, precio) values (app.negocio_actual(), 'Gorra P', 'Unidad', 10) returning id into p;
  insert into ids values ('gorra', p);

  -- Cajero sin permisos
  perform pg_temp.entrar('00000000-0000-0000-0000-000000000202');
  assert current_setting('app.permisos') = '', 'sin permisos';
  assert not app.tiene_permiso('precios'), 'no tiene precios';
  begin
    perform app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 1, 'precio', 8)), '[{"metodo":"efectivo","monto":8}]');
    assert false, 'no cambia precios';
  exception when insufficient_privilege then null;
  end;
  select * into r from app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', p, 'cantidad', 1)), '[{"metodo":"efectivo","monto":10}]');
  begin
    perform app.anular_venta(r.venta_id, 'Prueba');
    assert false, 'no anula';
  exception when insufficient_privilege then null;
  end;
  begin
    perform app.ajustar_stock(p, 5, 'Conteo');
    assert false, 'no ajusta stock';
  exception when insufficient_privilege then null;
  end;
  insert into ids values ('venta', r.venta_id);
end $$;

-- El dueño le da permisos de precios y anular
reset role;
update app.membresia set permisos = array['precios', 'anular', 'productos']
where usuario_id = '00000000-0000-0000-0000-000000000202';
update app.membresia set permisos = array['gastos'] where usuario_id = '00000000-0000-0000-0000-000000000203';
set local role alcien_app;

do $$
declare
  r record;
begin
  perform pg_temp.entrar('00000000-0000-0000-0000-000000000202');
  assert app.tiene_permiso('anular') and not app.tiene_permiso('reportes'), 'solo lo que se le dio';
  select * into r from app.registrar_venta(jsonb_build_array(jsonb_build_object('producto_id', (select id from ids where clave = 'gorra'), 'cantidad', 1, 'precio', 8, 'descuento', 1)),
    '[{"metodo":"efectivo","monto":7}]');
  assert r.total = 7, 'con permiso cambia precio y descuenta';
  perform app.anular_venta((select id from ids where clave = 'venta'), 'Error de cobro');
  perform app.ajustar_stock((select id from ids where clave = 'gorra'), 5, 'Conteo');

  -- El bodeguero con permiso de gastos
  perform pg_temp.entrar('00000000-0000-0000-0000-000000000203');
  perform app.registrar_gasto_v2(jsonb_build_object('categoria', 'Transporte', 'monto', 2, 'metodo', 'transferencia'));
end $$;

rollback;
