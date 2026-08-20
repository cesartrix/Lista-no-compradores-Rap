# Listado de no compradores de mes en curso

Página que muestra los clientes con la columna **CCC x Bultos** vacía en el Google Sheet publicado, filtrable por **Nro Vendedor** y **Ruta**. Los datos se leen en vivo en cada visita, no son una copia estática.

## Por qué hay una función serverless (`api/sheet.js`)

Google no habilita CORS en el endpoint `pub?output=csv`, así que si `index.html` intenta hacer `fetch()` directo a Google desde el navegador, el pedido falla (por eso no cargaba antes). La función `api/sheet.js` hace ese fetch del lado del servidor (sin restricción de CORS) y se lo entrega a la página como JSON, junto con la fecha de última modificación del Sheet (header `Last-Modified`, cuando Google lo envía).

## Estructura

```
index.html      → la página (HTML + CSS + JS, todo en un archivo)
api/sheet.js     → función serverless de Vercel que trae el CSV del Sheet
package.json     → metadata mínima del proyecto
```

## Desplegar en Vercel

1. Subí esta carpeta a un repositorio de GitHub (podés arrastrar los archivos en github.com o usar `git init && git add . && git commit -m "listado no compradores" && git push`).
2. Entrá a [vercel.com](https://vercel.com), "Add New… → Project" e importá ese repositorio.
3. No hace falta configurar nada (Framework Preset: "Other", sin build command). Vercel detecta `index.html` como sitio estático y `api/sheet.js` como función serverless automáticamente.
4. Deploy. Listo — la URL que te da Vercel ya sirve la página funcionando.

## Probarlo en tu máquina antes de subirlo

Necesitás la CLI de Vercel (porque `index.html` depende de la función `/api/sheet`, que solo corre con el runtime de Vercel):

```
npm i -g vercel
vercel dev
```

Abriendo `index.html` directamente como archivo local (doble clic) **no va a funcionar**, porque `/api/sheet` no existe fuera de Vercel.

## Si cambia el Google Sheet

Si el link de "Publicar en la Web" cambia, actualizá la constante `CSV_URL` en `api/sheet.js`.
