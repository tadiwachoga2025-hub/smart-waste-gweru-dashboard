import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";

export const firebaseConfig = {
  apiKey: "AIzaSyBENPTSzwfRKhowI0KuTiTburcnUvfVUe4",
  authDomain: "smart-waste-gweru.firebaseapp.com",
  databaseURL: "https://smart-waste-gweru-default-rtdb.firebaseio.com",
  projectId: "smart-waste-gweru",
  storageBucket: "smart-waste-gweru.firebasestorage.app",
  messagingSenderId: "428609945330",
  appId: "1:428609945330:web:8c78051a7df948760b5a6b"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);
