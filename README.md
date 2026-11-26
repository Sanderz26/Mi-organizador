# Organizador

App personal para Windows y Android: estudio, tareas, calendario con festivos de Colombia, gimnasio, dieta, negocio de impresión 3D, notas con archivos y un sistema de niveles y rachas.

## Descargar

Ve a **Releases** (columna derecha de esta página) y descarga la versión más reciente:

- **PC con Windows:** `Organizador-Setup-x.y.z.exe`. Si Windows muestra "Windows protegió tu PC", toca *Más información* → *Ejecutar de todas formas* (pasa porque la app no está firmada por una empresa).
- **Tableta Android:** `Organizador-x.y.z.apk`. Ábrelo desde la tableta y permite "Instalar apps desconocidas" para tu navegador o administrador de archivos.

Cada vez que se sube un cambio a `main`, GitHub genera los instaladores nuevos en unos 10–15 minutos.

## Datos

- Todo se guarda en el dispositivo. En Windows también se hace una copia diaria automática (últimos 14 días).
- Para pasar datos entre el PC y la tableta, o como respaldo: **Ajustes → Exportar respaldo** y guárdalo en Google Drive; en el otro dispositivo usa **Restaurar respaldo**.

## Desarrollo

```bash
npm install
npm run dev        # interfaz en el navegador
npm run electron   # versión de escritorio (tras npm run build)
```

- Interfaz: JavaScript + Vite, gráficas con Chart.js, íconos Tabler.
- Windows: Electron (`electron/`), instalador con electron-builder.
- Android: Capacitor (`android/`), APK firmado con la llave de `android/app/organizador-release.p12`.
