import http from "http";
import { URL } from "url";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

function readEnvFile(path)
{
	if (!fs.existsSync(path)) return "";
	return fs.readFileSync(path, "utf8");
}

function upsertEnv(envText, key, value)
{
	const line = `${key}=${value}`;
	const re = new RegExp(`^${key}=.*$`, "m");
	if (re.test(envText))
	{
		return envText.replace(re, line);
	}
	return envText.replace(/\s*$/, "\n") + line + "\n";
}

async function exchangeCodeForTokens(code, redirectUri, clientId, clientSecret)
{
	const tokenUrl =
		`https://id.twitch.tv/oauth2/token` +
		`?client_id=${encodeURIComponent(clientId)}` +
		`&client_secret=${encodeURIComponent(clientSecret)}` +
		`&code=${encodeURIComponent(code)}` +
		`&grant_type=authorization_code` +
		`&redirect_uri=${encodeURIComponent(redirectUri)}`;

	const res = await fetch(tokenUrl, { method: "POST" });
	const data = await res.json();

	if (!res.ok)
	{
		throw new Error(`Token exchange failed: ${res.status} ${JSON.stringify(data)}`);
	}

	return data;
}

async function main()
{
	const ENV_PATH = ".env";
	const env = readEnvFile(ENV_PATH);

	const clientId = (process.env.TWITCH_CLIENT_ID || "").trim();
	const clientSecret = (process.env.TWITCH_CLIENT_SECRET || "").trim();

	if (!clientId || !clientSecret)
	{
		console.log("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET in your .env first.");
		process.exit(1);
	}

	const PORT = 3000;
	const redirectUri = `http://localhost:${PORT}/callback`;

	const scope = ["chat:read", "chat:edit"].join(" "); // keep what you used before
	const state = Math.random().toString(16).slice(2);

	const authorizeUrl =
		`https://id.twitch.tv/oauth2/authorize` +
		`?client_id=${encodeURIComponent(clientId)}` +
		`&redirect_uri=${encodeURIComponent(redirectUri)}` +
		`&response_type=code` +
		`&scope=${encodeURIComponent(scope)}` +
		`&state=${encodeURIComponent(state)}`;

	const server = http.createServer(async (req, resp) =>
	{
		try
		{
			const u = new URL(req.url, redirectUri);
			if (u.pathname !== "/callback")
			{
				resp.writeHead(404);
				resp.end("Not found");
				return;
			}

			const gotState = u.searchParams.get("state") || "";
			const code = u.searchParams.get("code") || "";
			const error = u.searchParams.get("error") || "";

			if (error)
			{
				resp.writeHead(400);
				resp.end(`OAuth error: ${error}`);
				server.close();
				return;
			}

			if (!code || gotState !== state)
			{
				resp.writeHead(400);
				resp.end("Missing code or state mismatch.");
				server.close();
				return;
			}

			const tokens = await exchangeCodeForTokens(code, redirectUri, clientId, clientSecret);

			let envText = readEnvFile(ENV_PATH);
			envText = upsertEnv(envText, "TWITCH_OAUTH", tokens.access_token);
			envText = upsertEnv(envText, "TWITCH_REFRESH", tokens.refresh_token || "");
			fs.writeFileSync(ENV_PATH, envText, "utf8");

			resp.writeHead(200, { "Content-Type": "text/plain" });
			resp.end("Tokens saved to .env. You can close this tab.");

			console.log("Saved TWITCH_OAUTH and TWITCH_REFRESH to .env.");
			server.close();
		}
		catch (e)
		{
			resp.writeHead(500);
			resp.end("Failed. Check console.");
			console.error(e);
			server.close();
		}
	});

	server.listen(PORT, () =>
	{
		console.log("Open this URL in your browser, authorize, then come back here:");
		console.log(authorizeUrl);
	});
}

main();
