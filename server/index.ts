// server/index.ts
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startReminderScheduler } from "./scheduler";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Lightweight API logger that truncates large JSON bodies
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined;

  // Bind the original json method
  const originalResJson = res.json.bind(res) as (body?: any) => any;

  // Override res.json to capture the body, then call the original with ONE arg
  (res as any).json = function (bodyJson: any) {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse !== undefined) {
        try {
          logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
        } catch {
          // ignore circular structures
        }
      }
      if (logLine.length > 80) logLine = logLine.slice(0, 79) + "…";
      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  // Centralized error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err?.status || err?.statusCode || 500;
    const message = err?.message || "Internal Server Error";
    if (app.get("env") === "development") console.error(err);
    res.status(status).json({ message });
  });

  // Only set up Vite in development (after routes so it doesn’t shadow APIs)
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Serve on PORT (default 5000). Bind to 0.0.0.0.
  const port = Number.parseInt(process.env.PORT || "5000", 10) || 5000;
  server.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);

    // Start the session reminder scheduler
    startReminderScheduler();
  });
})();
