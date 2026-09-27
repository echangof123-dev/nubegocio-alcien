# Archivos de prueba

- `firma-*.p12.b64`: firmas **falsas** creadas con OpenSSL para las pruebas (titular "JUAN ANDRES PEREZ LOPEZ", autoridad "AC PRUEBA ALCIEN"). No sirven ante el SRI. Tres formatos: `moderna` (PBES2/AES, contraseña `Prueba.123`), `legacy` (RC2-40 + 3DES, `Prueba.123`) y `tresdes` (3DES, `clave ñandú`).
- `xsd/`: esquemas oficiales de comprobantes electrónicos del SRI (factura 2.1.0, que también valida la 1.1.0, y nota de crédito 1.1.0) y el de XMLDSig del W3C.

Nunca pongas aquí una firma real.
