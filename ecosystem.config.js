// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'rmras-backend',
      script: 'dist/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      merge_logs: true,
    },
  ],
};
