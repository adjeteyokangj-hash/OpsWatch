module.exports = {
  apps: [
    {
      name: "opswatch-api",
      cwd: "./apps/api",
      script: "./dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: "4000"
      },
      env_file: "./apps/api/.env",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      time: true
    },
    {
      name: "opswatch-web",
      cwd: "./apps/web",
      script: "./node_modules/next/dist/bin/next",
      args: "start -p 3002",
      env: {
        NODE_ENV: "production",
        PORT: "3002"
      },
      env_file: "./apps/web/.env.local",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      time: true
    },
    {
      name: "opswatch-worker",
      cwd: "./apps/worker",
      script: "./dist/index.js",
      env: {
        NODE_ENV: "production"
      },
      env_file: "./apps/worker/.env",
      autorestart: true,
      max_restarts: 20,
      restart_delay: 3000,
      time: true
    }
  ]
};
