# Deployment
- The app is published from Google AI Studio to Cloud Run (project signalbloom-prototype, region asia-southeast1) at https://signalbloom.ai.studio.
- Database: Cloud SQL (PostgreSQL), reached only through the Cloud SQL connector (no public access, no authorized networks).
- Sign-in: Firebase Auth (email and password). The live .run.app domain is listed under Firebase's authorized domains.
- Secrets (Gemini API key, database settings) come from the app's secrets, never from code. The repo contains the Firebase web API key in firebase-applet-config.json. This key is public by design; it only identifies the Firebase project. Access is protected by Firebase Auth sign-in, backend role checks and Firebase's authorized domains. No secret keys (Gemini, database) are in the repo.
- Production runs with NODE_ENV=production, so dev pages, the sample data generator and Simulate fault are off.
- Gemini runs on a paid Tier 1 key with US$5 of prepaid credit and no auto-reload, so spending can't exceed US$5.
- Connecting an agent: add a site in Account & Settings, copy its setup code, set cloud_url (the live URL) and setup_code in the agent's config.yaml, then run python -m signalbloom_agent.
