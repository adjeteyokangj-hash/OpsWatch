const requestMap = new Map<string, { count: number; resetAt: number }>();

export const rateLimit = (req: any, res: any, next: () => void) => {
  const key = req.ip || "unknown";
  const now = Date.now();
  const bucket = requestMap.get(key);

  if (!bucket || now > bucket.resetAt) {
    requestMap.set(key, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > 200) {
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  next();
};
