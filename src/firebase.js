import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBeqNZ6luePtC4KJbgZxcvxHIUC9H3FoJc",
  authDomain: "edn-fantasy-2026.firebaseapp.com",
  projectId: "edn-fantasy-2026",
  storageBucket: "edn-fantasy-2026.firebasestorage.app",
  messagingSenderId: "29005747040",
  appId: "1:29005747040:web:5208bcc664e941c2768405",
  measurementId: "G-30CZ82YGWP",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

let anonymousAuthPromise = null;

function getAnonymousAuthErrorMessage(error) {
  const code = error?.code || "";

  if (code === "auth/operation-not-allowed" || code === "auth/admin-restricted-operation") {
    return [
      "O login Anônimo está desativado no Firebase.",
      "Abra console.firebase.google.com → projeto edn-fantasy-2026 → Authentication → Sign-in method → Anonymous → Ativar → Salvar.",
      "Se já estiver ativo, confira em Google Cloud → Credentials se a API key não bloqueia o Firebase Authentication.",
    ].join(" ");
  }

  if (code === "auth/network-request-failed") {
    return "Sem conexão com o Firebase. Confira sua internet e tente de novo.";
  }

  return error?.message || "Não foi possível conectar ao modo online.";
}

export async function ensureAnonymousAuth() {
  // Always prefer the live currentUser if the SDK has it.
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }

  if (!anonymousAuthPromise) {
    anonymousAuthPromise = signInAnonymously(auth)
      .then((credential) => {
        // After successful sign-in, the SDK should have auth.currentUser populated.
        return auth.currentUser?.uid || credential.user.uid;
      })
      .catch((error) => {
        anonymousAuthPromise = null;
        const wrappedError = new Error(getAnonymousAuthErrorMessage(error));
        wrappedError.cause = error;
        throw wrappedError;
      });
  }

  const uid = await anonymousAuthPromise;

  // Double-check after the promise settles (helps with some timing edge cases).
  if (auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }
  return uid;
}