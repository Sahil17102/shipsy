module.exports = {
  apps: [
    {
      name: "goshipsy-api",
      cwd: "/opt/goshipsy/current/api",
      script: "server.mjs",
      env: {
        NODE_ENV: "production",
        PORT: "5014",
        DATA_DIR: "/opt/goshipsy/shared/data",
        DOTENV_CONFIG_PATH: "/opt/goshipsy/shared/runtime.env",
        ALLOWED_ORIGINS: "https://goshipsy.in,https://www.goshipsy.in,https://admin.goshipsy.in",
      },
    },
  ],
};
