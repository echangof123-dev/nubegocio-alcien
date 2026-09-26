-- Seguridad por fila: un negocio nunca ve ni toca los datos de otro.
begin;

insert into auth.usuario (id, celular) values
  ('00000000-0000-0000-0000-0000000000a1', '+593990000011'),
  ('00000000-0000-0000-0000-0000000000b2', '+593990000022');

create temp table ids (quien text primary key, negocio uuid);
grant select on ids to alcien_app;

insert into ids values ('a', app.crear_negocio('00000000-0000-0000-0000-0000000000a1', 'T045', 'Tienda A'));
insert into ids values ('b', app.crear_negocio('00000000-0000-0000-0000-0000000000b2', 'T045', 'Tienda B'));

-- A partir de aquí actúa la API, con su rol sin privilegios
select set_config('app.negocio_id', '', true);
set local role alcien_app;

do $$
declare
  a uuid := (select negocio from ids where quien = 'a');
  b uuid := (select negocio from ids where quien = 'b');
  n int;
begin
  -- Sin contexto no se ve nada
  assert (select count(*) from app.negocio) = 0, 'sin contexto no se ven negocios';
  assert (select count(*) from app.producto) = 0, 'sin contexto no se ven productos';

  -- El usuario A entra a su negocio
  assert app.entrar_negocio('00000000-0000-0000-0000-0000000000a1', a) = 'dueno', 'A entra como dueño';
  assert (select count(*) from app.negocio) = 1, 'A ve solo su negocio';
  assert (select id from app.negocio) = a, 'y es el suyo';
  select count(*) into n from app.producto where negocio_id = b;
  assert n = 0, 'A no ve productos de B aunque filtre por su id';

  -- A no puede escribir en B
  begin
    insert into app.categoria (negocio_id, nombre) values (b, 'Intrusa');
    assert false, 'A no debe poder crear categorías en B';
  exception when insufficient_privilege then null;
  end;

  update app.producto set precio = 0 where negocio_id = b;
  get diagnostics n = row_count;
  assert n = 0, 'A no debe poder cambiar precios de B';

  -- A no puede entrar al negocio de B
  begin
    perform app.entrar_negocio('00000000-0000-0000-0000-0000000000a1', b);
    assert false, 'A no pertenece a B';
  exception when insufficient_privilege then null;
  end;

  -- La API no puede tocar el catálogo ni la suscripción directamente
  begin
    update catalogo.plan set precio_mensual = 0;
    assert false, 'la API no edita el catálogo';
  exception when insufficient_privilege then null;
  end;
  begin
    update app.suscripcion set plan = 'pro';
    assert false, 'la API no cambia planes directamente';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
rollback;
