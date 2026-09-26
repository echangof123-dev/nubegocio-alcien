-- Búsqueda de tipo de negocio: sin tildes, con errores de escritura y frases naturales.
begin;

create function pg_temp.primero(texto text) returns text language sql as $$
  select nombre from catalogo.buscar_tipos(texto, 5) limit 1;
$$;

do $$
begin
  assert pg_temp.primero('tienda') = 'Tienda de barrio', 'tienda → Tienda de barrio';
  assert pg_temp.primero('tengo una tienda de bario') = 'Tienda de barrio', 'error de escritura: bario';
  assert pg_temp.primero('abarrotes') = 'Tienda de barrio', 'sinónimo: abarrotes';
  assert pg_temp.primero('cevicheria') = 'Cevichería', 'sin tilde: cevicheria';
  assert pg_temp.primero('mi negocio es una cevicheria') = 'Cevichería', 'frase natural';
  assert pg_temp.primero('peluqueria') = 'Peluquería', 'peluqueria';
  assert pg_temp.primero('vendo ropa') = 'Tienda de ropa', 'vendo ropa → Tienda de ropa';
  assert pg_temp.primero('insumos para el campo') = 'Almacén agrícola / agroquímicos', 'insumos para el campo';
  assert pg_temp.primero('FERRETERIA') = 'Ferretería', 'mayúsculas';
  assert pg_temp.primero('pollo asado') = 'Asadero', 'sinónimo: pollo asado';

  assert not exists (select 1 from catalogo.buscar_tipos('xyz', 5)), 'texto sin sentido no devuelve nada';
  assert not exists (select 1 from catalogo.buscar_tipos('a', 5)), 'una sola letra no busca';
  assert (select count(*) from catalogo.buscar_tipos('tienda', 3)) = 3, 'respeta el límite';
  assert (select count(*) from catalogo.buscar_tipos('tienda', 500)) <= 20, 'límite máximo de 20';
end $$;

rollback;
