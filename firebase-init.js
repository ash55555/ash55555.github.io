// Firebase project config, from Firebase console → Project settings → your web app.
var FIREBASE_CONFIG = {
  apiKey: "AIzaSyAnMtB4mvPqzhPq5rtgQ-6XgjY1uaz1mp0",
  authDomain: "ash-ttrpg.firebaseapp.com",
  databaseURL: "https://ash-ttrpg-default-rtdb.firebaseio.com",
  projectId: "ash-ttrpg",
  storageBucket: "ash-ttrpg.firebasestorage.app",
  messagingSenderId: "472699226703",
  appId: "1:472699226703:web:9d03a58e26a258b1e1383a"
};

if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}
