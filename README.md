# estudios-service

Servicio Node.js/Express + PostgreSQL que gestiona los **estudios hipotecarios**, sus archivos y los catálogos legales (tipos de documento, estados, clientes/mandantes). Réplica del `proyects-service` de ISA1, adaptado al dominio jurídico chileno.

## Endpoints

| Método  | Ruta | Descripción |
|---------|------|-------------|
| GET     | `/api-estudios/health`                                | health |
| GET     | `/api-estudios/catalogos/clasificaciones`             | tipos de documento (escritura, cert. CBR…) |
| GET     | `/api-estudios/catalogos/estados`                     | borrador, en_analisis, observado, verificado |
| GET     | `/api-estudios/catalogos/clientes`                    | mutuarias, bancos, particulares |
| GET     | `/api-estudios/estudios?estado=&search=`              | listado de cartera |
| GET     | `/api-estudios/estudios/:folio`                       | detalle |
| POST    | `/api-estudios/estudios`                              | apertura de expediente (genera folio EH-YYYY-NNNN) |
| PUT     | `/api-estudios/estudios/:folio/status`                | cambia estado |
| GET     | `/api-estudios/estudios/:folio/archivos`              | archivos del estudio |
| PATCH   | `/api-estudios/estudios/:folio/archivos/:fileId`      | edita metadatos del archivo |
| DELETE  | `/api-estudios/estudios/:folio/archivos/:fileId`      | soft delete del archivo |
| GET     | `/api-estudios/signed-url?gcs_path=...`               | URL firmada GCS para descargar |

## Desarrollo

```bash
npm install
cp .env.example .env
# Levantar postgres local con migrations/001_init.sql aplicado
npm run dev
```

Puerto por defecto: `8082`.

## Esquema

Ver `migrations/001_init.sql` en la raíz de hipotecai. Tablas con prefijo `dt_`: `dt_estudio`, `dt_archivos`, `dt_clasificaciones`, `dt_estados_estudio`, `dt_clientes`, `dt_extraccion`, `dt_sintetizador`, `dt_hallazgos`.

## Generación de folio

Al crear un estudio, el folio sigue el formato `EH-{YYYY}-{NNNN}` con NNNN como contador anual (`COUNT(*)+1` para el año). Garantiza unicidad relativa al año.
