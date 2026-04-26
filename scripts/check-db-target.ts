const url = new URL(process.env.DATABASE_URL ?? "");
console.log("DB host:", url.hostname);
console.log("DB name:", url.pathname.slice(1));
console.log("DB user:", url.username);
