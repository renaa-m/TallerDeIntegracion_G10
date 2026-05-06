import { initializeApp } from "firebase/app";

// Tu configuración (manténla tal cual)
const firebaseConfig = {
  apiKey: "AIzaSyCi796O3Az_gQy30wMK18ZvFrU7iG6Xrjs",
  authDomain: "explorador-imfd.firebaseapp.com",
  projectId: "explorador-imfd",
  storageBucket: "explorador-imfd.firebasestorage.app",
  messagingSenderId: "1071472121066",
  appId: "1:1071472121066:web:9b0d08a8e26a14062f3393",
  measurementId: "G-555CW3816H"
};

// Agregamos 'export' para que TypeScript no se queje y podamos usarlo en otros archivos
export const app = initializeApp(firebaseConfig);