# Valtior — Setup Guide

Follow these steps in order. The whole process takes about 10–15 minutes.

---

## Step 1 — Install Docker Desktop

Docker is the only tool you need to install. It runs everything else automatically.

1. Go to: **https://www.docker.com/products/docker-desktop/**
2. Download the version for your operating system (Mac or Windows)
3. Run the installer and follow the instructions
4. When it's done, open **Docker Desktop** from your Applications / Start menu
5. Wait until you see the green "Docker Desktop is running" status

**That's the only installation required.**

---

## Step 2 — Find the Valtior folder

The `valtior` folder is saved in your selected workspace (the Valtior folder on your computer).

Open your file manager and find the folder called `valtior` inside your Valtior workspace.

---

## Step 3 — Open Terminal

**On Mac:**
- Press `Command + Space`, type `Terminal`, press Enter
- In the Terminal window, type:
  ```
  cd /path/to/your/Valtior/valtior
  ```
  (Replace the path with the actual location of the valtior folder)

**On Windows:**
- Press `Windows + R`, type `cmd`, press Enter
- Navigate to the valtior folder:
  ```
  cd C:\path\to\your\Valtior\valtior
  ```

**Shortcut (Mac & Windows):** Open your file manager, navigate to the `valtior` folder, then drag that folder into the Terminal window — it will fill in the path automatically.

---

## Step 4 — Add your API key (optional but recommended)

The platform works without an API key for basic structure — but AI parsing and validation requires one.

1. In the `valtior` folder, find the file called `.env.example`
2. Make a copy of it and name the copy `.env` (no `.example` at the end)
3. Open `.env` with any text editor (Notepad, TextEdit, etc.)
4. Replace `your-key-here` with your Anthropic API key
5. Save the file

Get your API key at: **https://console.anthropic.com**

---

## Step 5 — Start Valtior

In your Terminal, with the `valtior` folder open, run:

```
docker compose up
```

The first time, this will take 2–5 minutes to download and build everything.
You'll see log messages scrolling — this is normal.

When you see:
```
valtior-frontend  | VITE v5.x ready at http://localhost:3000
valtior-backend   | Application startup complete.
```

**Valtior is running.**

---

## Step 6 — Open the platform

Open your web browser and go to:

**http://localhost:3000**

You should see the Valtior dashboard.

---

## Stopping Valtior

In the Terminal window where Valtior is running, press `Ctrl + C`.

To restart it later, run `docker compose up` again in the same folder.

---

## Troubleshooting

**"Docker not found" error:**
→ Make sure Docker Desktop is open and shows "Running" status.

**Port 3000 already in use:**
→ Something else is using that port. In `docker-compose.yml`, change `"3000:3000"` to `"3001:3000"` and access the app at http://localhost:3001.

**API parsing not working:**
→ Check that your `.env` file exists and contains a valid `ANTHROPIC_API_KEY`.

**Any other issue:**
→ Run `docker compose logs` in the terminal to see error messages.

---

## Using the platform

1. Click **New Project** to create a validation engagement
2. Fill in the project name, client institution, and model owner
3. In the project, paste your model text (risk factors, weights, bands, triggers)
4. Click **Upload & Parse** — the system will structure the model and run checks
5. Go to the **Findings** tab to review what was detected
6. Click any finding to expand it and annotate it (Accept / Follow up / Reject)

---

*Valtior MVP v0.1 — Built for AML/KYC model validation*
