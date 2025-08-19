# Video Backend

## Quick start (local)

1. Install dependencies
   ```
   npm install
   ```

2. Create .env based on .env.example
   ```
   cp .env.example .env
   # edit .env and add MONGO_URI and JWT_SECRET
   ```

3. Run dev server
   ```
   npm run dev
   ```

## Endpoints (examples)

- POST /api/auth/signup
- POST /api/auth/login
- POST /api/videos/upload (form-data; field 'video' for file, or 'externalUrl' for link) - requires Authorization: Bearer <token>
- GET  /api/videos
- GET  /api/videos/:id/meta
- GET  /api/videos/:id/stream
- POST /api/videos/:id/favorite - requires auth
- POST /api/videos/:id/history - requires auth

