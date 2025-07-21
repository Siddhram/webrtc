import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: "AIzaSyC80b-Jnth6H9N72kgZ-qD2Vk-xWcAxneg",
  authDomain: "logstrike-362b7.firebaseapp.com",
  projectId: "logstrike-362b7",
  storageBucket: "logstrike-362b7.firebasestorage.app",
  messagingSenderId: "136606483960",
  appId: "1:136606483960:web:8f5e1dd94e10d28c71420d",
  measurementId: "G-S9V13231R0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const analytics = getAnalytics(app);

export { app, db, analytics }; 