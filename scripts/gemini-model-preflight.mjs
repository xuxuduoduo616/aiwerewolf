#!/usr/bin/env node
// Explicit coordinator-only read-only capability check. It never generates text.
import { GoogleGenAI } from '@google/genai';

const ids = ['gemini-3.6-flash', 'gemini-2.5-flash'];
const key = process.env.GEMINI_API_KEY || process.env.API_KEY;
if (!key) {
  console.error('Gemini model preflight: server key is not configured.');
  process.exitCode = 1;
} else {
  try {
    const client = new GoogleGenAI({ apiKey: key });
    const models = await Promise.all(ids.map(model => client.models.get({ model })));
    const exact = models.every((result, index) => result?.name === ids[index] || result?.name === `models/${ids[index]}`);
    if (!exact) throw new Error('model-id-mismatch');
    console.log('Gemini model preflight: both exact expression models are available.');
  } catch {
    console.error('Gemini model preflight: capability verification failed.');
    process.exitCode = 1;
  }
}
