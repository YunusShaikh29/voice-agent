# VOCO

A voice-first task management assistant built with Next.js, TypeScript, Prisma, PostgreSQL, and OpenAI-compatible function calling.
<img width="1919" height="959" alt="image" src="https://github.com/user-attachments/assets/0b7789b2-65dd-4b0c-adc1-e85477b361be" />


Users can create, update, retrieve, and delete tasks using natural voice commands. Speech-to-text is handled in the browser using the Web Speech API, while text-to-speech provides spoken responses from the assistant.

## Features

* Voice-controlled task management
* Natural language task creation and updates
* Real-time speech-to-text input
* Spoken AI responses
* Persistent task storage with PostgreSQL
* Function calling for task operations
* Session-based conversation history

## Tech Stack

* Next.js
* TypeScript
* Tailwind CSS
* Prisma
* PostgreSQL
* OpenAI-compatible API
* Web Speech API

## Environment Variables

Create a `.env` file using `.env.example` and provide the required values.
DATABASE_URL & LLM API Key

## Run Locally

```bash
npm install
npm run dev
```
