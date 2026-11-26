// Identificadores de la app en Google Cloud. El secreto de Windows no vive en el código:
// GitHub lo inyecta al compilar desde el secreto GOOGLE_DESKTOP_SECRET (Settings → Secrets → Actions).
export const GOOGLE = {
  desktopClientId: '689565943745-fhd01g4l60eo77m308s86ah69aul1ksl.apps.googleusercontent.com',
  desktopClientSecret: typeof __GOOGLE_DESKTOP_SECRET__ !== 'undefined' ? __GOOGLE_DESKTOP_SECRET__ : '',
  androidClientId: '689565943745-jh8kuc8kvnma3srva96u1mo9cc120012.apps.googleusercontent.com',
  androidRedirect: 'com.roa.organizador:/oauth2redirect',
};
