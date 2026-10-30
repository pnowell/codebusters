import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TestPacket } from '../src/types';

// Load .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach((line) => {
  const [k, ...v] = line.split('=');
  if (k && v.length) env[k.trim()] = v.join('=').trim();
});

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const practiceTest1: TestPacket = {
  testId: 'invitational-practice-1',
  title: 'Invitational Practice Test #1',
  description:
    'Science Olympiad Division A Practice Exam. 5 problems covering Pigpen, Galactic, Atbash, and Caesar ciphers. Work carefully — unanswered letters count as errors!',
  timeLimitSeconds: 2100, // 35 minutes
  active: true,
  createdAt: serverTimestamp(),
  questions: [
    {
      questionNumber: 1,
      cipher: 'pigpen',
      quoteId: 72, // "Instead of cursing the darkness, light a candle."
      points: 150,
      description: 'Decode this quote encrypted with the Pigpen / Masonic cipher.',
    },
    {
      questionNumber: 2,
      cipher: 'galactic',
      quoteId: 8, // "There was, I found, always more to learn."
      points: 150,
      description: 'Decode this quote written in the Standard Galactic Alphabet.',
    },
    {
      questionNumber: 3,
      cipher: 'atbash',
      quoteId: 4, // "Eternity is a long time, especially towards the end."
      points: 150,
      description: 'Decode this quote using the Atbash cipher (A ↔ Z, B ↔ Y).',
    },
    {
      questionNumber: 4,
      cipher: 'caesar',
      quoteId: 21, // "Do no harm and leave the world a better place than you found it."
      points: 150,
      params: { caesarShift: 2 },
      description: 'Decode this quote encrypted with a Caesar shift of +2 (A → C).',
    },
    {
      questionNumber: 5,
      cipher: 'pigpen',
      quoteId: 77, // "The human foot is a masterpiece of engineering and a work of art."
      points: 200,
      isTiebreaker: true,
      description: '★ TIEBREAKER: Decode this quotation from Leonardo da Vinci using the Pigpen cipher.',
    },
  ],
};

const practiceTest2: TestPacket = {
  testId: 'invitational-practice-2',
  title: 'Invitational Practice Test #2',
  description:
    'Science Olympiad Division A Warmup Exam. 4 problems covering Caesar, Atbash, and Pigpen ciphers. Decode accurately and beat the clock!',
  timeLimitSeconds: 1500, // 25 minutes
  active: true,
  createdAt: serverTimestamp(),
  questions: [
    {
      questionNumber: 1,
      cipher: 'caesar',
      quoteId: 21, // "Do no harm and leave the world a better place than you found it."
      points: 125,
      params: { caesarShift: 4 },
      description: 'Decode this quote encrypted with a Caesar shift of +4 (A → E).',
    },
    {
      questionNumber: 2,
      cipher: 'atbash',
      quoteId: 70, // "The reward of a thing well done is having done it."
      points: 125,
      description: 'Decode this quote using the Atbash cipher (A ↔ Z, B ↔ Y).',
    },
    {
      questionNumber: 3,
      cipher: 'pigpen',
      quoteId: 22, // "This book fills a much-needed gap."
      points: 150,
      description: 'Decode this quote encrypted with the Pigpen / Masonic cipher.',
    },
    {
      questionNumber: 4,
      cipher: 'galactic',
      quoteId: 72, // "Instead of cursing the darkness, light a candle."
      points: 200,
      isTiebreaker: true,
      description: '★ TIEBREAKER: Decode this quote written in the Standard Galactic Alphabet.',
    },
  ],
};

async function main() {
  console.log(`Seeding practice tests to Firestore projectId: ${env.VITE_FIREBASE_PROJECT_ID}...`);
  try {
    const testDoc1 = doc(db, 'tests', practiceTest1.testId);
    await setDoc(testDoc1, practiceTest1, { merge: true });
    console.log(`✅ Seeded ${practiceTest1.testId}`);

    // Slight delay so createdAt timestamp is distinctly newer
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const testDoc2 = doc(db, 'tests', practiceTest2.testId);
    await setDoc(testDoc2, practiceTest2, { merge: true });
    console.log(`✅ Seeded ${practiceTest2.testId}`);

    console.log('🎉 Successfully seeded practice tests to Firestore!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Failed to seed tests to Firestore:', err);
    process.exit(1);
  }
}

main();
