#!/usr/bin/env python3
"""Verificador independiente de la firma XAdES-BES (lxml + cryptography).

Recalcula los tres digests con la canonización C14N de libxml2 y verifica la firma RSA-SHA1
con el certificado incluido. Sirve para comprobar que nuestra firma (hecha sin librerías)
coincide con lo que calcula una implementación estándar, como la del SRI.

Uso: python3 verificar_firma.py comprobante.xml   → imprime OK o falla con el motivo.
"""
import base64
import copy
import hashlib
import sys

from lxml import etree
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding

NS = {"ds": "http://www.w3.org/2000/09/xmldsig#", "etsi": "http://uri.etsi.org/01903/v1.3.2#"}


def c14n(el):
    return etree.tostring(el, method="c14n", exclusive=False, with_comments=False)


def b64sha1(data):
    return base64.b64encode(hashlib.sha1(data).digest()).decode()


def main(ruta):
    doc = etree.parse(ruta, etree.XMLParser(remove_blank_text=False)).getroot()
    assert doc.get("id") == "comprobante", "la raíz debe tener id=comprobante"
    firmas = doc.findall("ds:Signature", NS)
    assert len(firmas) == 1, "debe haber una sola firma, hija de la raíz"
    sig = firmas[0]
    si = sig.find("ds:SignedInfo", NS)

    def por_id(i):
        r = doc.xpath("//*[@Id=$i or @id=$i]", i=i)
        assert len(r) == 1, f"id {i} no es único"
        return r[0]

    refs = si.findall("ds:Reference", NS)
    assert len(refs) == 3, "se esperan 3 referencias"
    for ref in refs:
        uri = ref.get("URI")[1:]
        destino = por_id(uri)
        if uri == "comprobante":
            sin_firma = copy.deepcopy(destino)
            sin_firma.remove(sin_firma.find("ds:Signature", NS))
            datos = c14n(sin_firma)
        else:
            datos = c14n(destino)
        assert b64sha1(datos) == ref.find("ds:DigestValue", NS).text, f"digest de #{uri} no coincide"

    der = base64.b64decode(sig.find("ds:KeyInfo/ds:X509Data/ds:X509Certificate", NS).text)
    cert = x509.load_der_x509_certificate(der)
    cert.public_key().verify(base64.b64decode(sig.find("ds:SignatureValue", NS).text), c14n(si),
                             padding.PKCS1v15(), hashes.SHA1())

    cd = sig.find(".//etsi:SigningCertificate/etsi:Cert/etsi:CertDigest/ds:DigestValue", NS).text
    assert cd == b64sha1(der), "digest del certificado"
    serie = sig.find(".//etsi:IssuerSerial/ds:X509SerialNumber", NS).text
    assert int(serie) == cert.serial_number, "número de serie"
    mod = sig.find(".//ds:RSAKeyValue/ds:Modulus", NS).text
    n = int.from_bytes(base64.b64decode(mod), "big")
    assert n == cert.public_key().public_numbers().n, "módulo de la llave"
    print("OK")


if __name__ == "__main__":
    main(sys.argv[1])
