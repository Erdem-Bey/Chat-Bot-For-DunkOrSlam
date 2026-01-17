import tmi from "tmi.js";
import dotenv from "dotenv";
dotenv.config();
import fs from "fs";

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

async function validateAccessToken(accessToken)
{
	const res = await fetch("https://id.twitch.tv/oauth2/validate",
	{
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	return res.ok;
}

async function refreshAccessToken(refreshToken, clientId, clientSecret)
{
	const tokenUrl =
		`https://id.twitch.tv/oauth2/token` +
		`?grant_type=refresh_token` +
		`&refresh_token=${encodeURIComponent(refreshToken)}` +
		`&client_id=${encodeURIComponent(clientId)}` +
		`&client_secret=${encodeURIComponent(clientSecret)}`;

	const res = await fetch(tokenUrl, { method: "POST" });
	const data = await res.json();

	if (!res.ok)
	{
		throw new Error(`Refresh failed: ${res.status} ${JSON.stringify(data)}`);
	}

	return data;
}

async function ensureValidToken()
{
	const clientId = (process.env.TWITCH_CLIENT_ID || "").trim();
	const clientSecret = (process.env.TWITCH_CLIENT_SECRET || "").trim();
	const refreshToken = (process.env.TWITCH_REFRESH || "").trim();
	const accessToken = (process.env.TWITCH_OAUTH || "").trim();

	if (!clientId || !clientSecret || !refreshToken)
	{
		throw new Error("Missing TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, or TWITCH_REFRESH in .env.");
	}

	if (accessToken && await validateAccessToken(accessToken))
	{
		return accessToken;
	}

	const refreshed = await refreshAccessToken(refreshToken, clientId, clientSecret);

	// Twitch may rotate refresh_token. Save both.
	const newAccess = refreshed.access_token;
	const newRefresh = refreshed.refresh_token || refreshToken;

	let envText = readEnvFile(".env");
	envText = upsertEnv(envText, "TWITCH_OAUTH", newAccess);
	envText = upsertEnv(envText, "TWITCH_REFRESH", newRefresh);
	fs.writeFileSync(".env", envText, "utf8");

	process.env.TWITCH_OAUTH = newAccess;
	process.env.TWITCH_REFRESH = newRefresh;

	return newAccess;
}

/**************************************************************************
***************************************************************************
***************************************************************************
***************************************************************************
***************************************************************************
***************************************************************************
***************************************************************************
***************************************************************************/

const CHANNEL = (process.env.CHANNEL || "dunkorslam").toLowerCase();
const WIZEBOT_NAME = "wizebot";
const DUNKORSLAM_NAME = "dunkorslam";
const DUNKBOT_NAME = "dunkbot";
const WIZEBOT_MSG_BEGIN_RESUB = "⭐️ RE-SUB ⭐️";
const WIZEBOT_MSG_BEGIN_NEWSUB = "⭐️ NEW SUB ⭐️";
const WIZEBOT_MSG_END_GIFT = "to the community!";
const MIN_IDIOT_GAP_MS = 300_000;	// minimal gap between replies to idiots
const DUP_WINDOW_MS = 30_000;		// Twitch duplicate window

// Every time the shop is opened, the code will buy an item from `SHOP_ITEMS_TO_BUY` in order.
// Example array initializations: [], [1], [2], [5, 2, 1];
const SHOP_ITEMS_TO_BUY = [1];
var ShopItemToBuyIndex = 0;

// Bet reopen request
const EnableReopenRequest = false;
var REOPEN_REQUEST_MESSAGES;
var LastReopenIndex = -1;

// Vote in the bets
const VOTE_FOR_TI = false;
const VOTE_FOR_DAILY = false;
const VOTE_OF_TI = "!no";
const VOTE_OF_DAILY = "!yes";

// Print different variants of "dnkM" if new subscriptions come very often.
const BASE = "dnkM";
const VARIANTS =
[
	BASE,
	`${BASE} ${BASE}`,
	`${BASE} ${BASE} ${BASE}`,
	`${BASE} ${BASE} ${BASE} ${BASE}`,
	`${BASE} ${BASE} ${BASE} ${BASE} ${BASE}`,
];

let lastReplyToIdiot = 0;
let lastReplyToWizeBot = 0;
let willReplyToIdiot = false;
let willReplyToWizeBot = false;
let variantIndex = 0;
const seenMsgIds = new Set();

await ensureValidToken();

const client = new tmi.Client
({
	options:
	{
		skipMembership: true,
		debug: false
	},
	connection:
	{
		secure: true,
		reconnect: true
	},
	identity:
	{
		username: process.env.TWITCH_USERNAME,
		password: `oauth:${process.env.TWITCH_OAUTH}`,
	},
	channels: [CHANNEL],
});

client.on("connected", () =>
{
	InitializeReopenMessages();
	console.log(GetTime() + " Connected. Listening for chat messages…");
});

client.on("message", (channel, tags, message, self) =>
{
	if (self) return;
	
	const from = (tags.username || "").toLowerCase();
	
	if (from === DUNKORSLAM_NAME)
	{
		processMessagesFrom_Dunk(channel, from, message).catch(console.error);
	}
	else if (from === WIZEBOT_NAME)
	{
		processMessagesFrom_WizeBot(channel, from, message, tags).catch(console.error);
	}
	else if (from === DUNKBOT_NAME)
	{
		processMessagesFrom_DunkBot(channel, from, message, tags).catch(console.error);
	}
	else
	{
		const startsWithSub =	message.startsWith(WIZEBOT_MSG_BEGIN_RESUB)
							||	message.startsWith(WIZEBOT_MSG_BEGIN_NEWSUB);
		if (startsWithSub)
		{
			processMessagesFrom_FakeSubIdiots(channel, from, message).catch(console.error);
		}
		else if (message == "!magikarp")
		{
			console.log(GetTime() + ` !magikarp (from: ${from}): "${message}"`);
		}
		else if (message == "!uguu")
		{
			console.log(GetTime() + ` !uguu (from: ${from})"`);
		}
	}
});

async function processMessagesFrom_Dunk(channel, dunkName, message)
{
	// Dunk rarely types messages to chat.
	// I don't want to miss them, so I will print them to my console.
	console.log(GetTime() + ` Dunk's Message: "${message}"`);
	
	// Dunk opens the shop with this message.
	// He types this message once in two hours, so I don't need a repition check here.
	if (message === "!open")
	{
		// I want to immediately buy the 2nd item in the shop. I don't want any delay.
		if (ShopItemToBuyIndex < SHOP_ITEMS_TO_BUY.length)
		{
			console.log(GetTime() + ` Buying item from shop: "${SHOP_ITEMS_TO_BUY[ShopItemToBuyIndex]}"`);
			await client.say(channel, `!deposit ${SHOP_ITEMS_TO_BUY[ShopItemToBuyIndex]}`);
			ShopItemToBuyIndex++;
		}
		else
		{
			console.log(GetTime() + " The shop is open, but there is nothing to buy in the list.");
		}
	}
	else if (message === "!NoMore")
	{
		if (EnableReopenRequest === true)
		{
			await Delay(2000, 5000);
			await client.say(channel, GetARandomReopenMessage());
		}
	}
	else if (message.startsWith("!DoYou? Noita Soler TI"))
	{
		if (VOTE_FOR_TI === true)
		{
			await Delay(20000, 30000);
			await client.say(channel, VOTE_OF_TI);
		}
	}
	else if (message.startsWith("!DoYou? Daily"))
	{
		if (VOTE_FOR_DAILY === true)
		{
			await Delay(20000, 30000);
			await client.say(channel, VOTE_OF_DAILY);
		}
	}
}

async function processMessagesFrom_WizeBot(channel, wizeBotName, message, tags)
{
	const startsWithSub =	message.startsWith(WIZEBOT_MSG_BEGIN_RESUB)
						||	message.startsWith(WIZEBOT_MSG_BEGIN_NEWSUB)
						||	message.endsWith(WIZEBOT_MSG_END_GIFT);
	
	if (startsWithSub)
	{
		const id = tags.id;
		if (id)
		{
			if (seenMsgIds.has(id)) return;
			seenMsgIds.add(id);
			if (seenMsgIds.size > 100) seenMsgIds.clear();
		}
		
		if (willReplyToWizeBot == true)
		{
			// It is already going to post a message. Cancel this one.
			return;
		}
		
		var subType = "-default console message-";
		if (message.startsWith(WIZEBOT_MSG_BEGIN_RESUB))
		{
			subType = "RESUB";
		}
		else if (message.startsWith(WIZEBOT_MSG_BEGIN_NEWSUB))
		{
			subType = "SUB";
		}
		else if (message.endsWith(WIZEBOT_MSG_END_GIFT))
		{
			subType = "GIFT";
		}
		
		// Set the flag that we are going to send a reply.
		willReplyToWizeBot = true;
		
		// Pick a message that avoids Twitch's 30s duplicate check
		const now = Date.now();
		if (now - lastReplyToWizeBot > DUP_WINDOW_MS)
		{
			// Fresh window: Reset to the first variant.
			variantIndex = 0;
		}
		else
		{
			// Still inside duplicate window: Rotate to next variant
			variantIndex = (variantIndex + 1) % VARIANTS.length;
		}
		const text = VARIANTS[variantIndex];
		
		// Random delay.
		await Delay(2000, 7000);
		
		try
		{
			// Reply to WizeBot.
			//process.stdout.write("Will try to celebrate... ");
			await client.say(channel, text);
			// Record last reply time.
			lastReplyToWizeBot = Date.now();
			// Log to the console.
			console.log(GetTime() + ` Replied to WizBot message [${subType}] : "${text}"`);
		}
		catch (e)
		{
			console.error("Send failed:", e);
		}
		finally
		{
			// Clear the flag.
			willReplyToWizeBot = false;
		}
	}
	else
	{
		console.log(GetTime() + ` WizBot: "${message}"`);
	}
}

async function processMessagesFrom_DunkBot(channel, wizeBotName, message, tags)
{
	if (message === "Anti-Weeb measures engaged!")
	{
		await Delay(0, 1000);
		await client.say(channel, `AYAYA We will return... AYAYA`);
	}
}

async function processMessagesFrom_FakeSubIdiots(channel, idiotName, message)
{
	if (willReplyToIdiot == true)
	{
		// It is already going to post a message. Cancel this one.
		return;
	}
	
	const now = Date.now();
	if ((now - lastReplyToIdiot) < MIN_IDIOT_GAP_MS)
	{
		// Don't reply to idiots too soon one after another.
		return;
	}
	
	// Set the flag that we are going to send a reply.
	willReplyToIdiot = true;
	
	// Reply to the idiot.
	try
	{
		// Random delay.
		await Delay(1000, 2000);
		//process.stdout.write("Will reply to the idiot... ");
		await client.say(channel, `${BASE} (I was fooled by an idiot!)`);
		// Record last reply time.
		lastReplyToIdiot = Date.now();
		// Log to the console.
		console.log(GetTime() + ` Replied to idiot: "${idiotName}"`);
	}
	catch (e)
	{
		console.error("Send failed:", e);
	}
	finally
	{
		// Clear the flag.
		willReplyToIdiot = false;
	}
}

client.connect().catch(console.error);

process.on("SIGINT", () =>
{
	console.log(GetTime() + " Disconnecting…");
	client.disconnect();
	process.exit();
});

function GetTime()
{
	const now = new Date();
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `[${hh}:${mm}:${ss}]`;
}

function GetDateTime()
{
	const now = new Date();
	const yyyy = now.getFullYear();
	const MM = String(now.getMonth() + 1).padStart(2, "0");
	const dd = String(now.getDate()).padStart(2, "0");
	const hh = String(now.getHours()).padStart(2, "0");
	const mm = String(now.getMinutes()).padStart(2, "0");
	const ss = String(now.getSeconds()).padStart(2, "0");
	return `[${yyyy}-${MM}-${dd} ${hh}:${mm}:${ss}]`;
}

function Delay(minMs, maxMs)
{
	const min = Math.min(minMs, maxMs);
	const max = Math.max(minMs, maxMs);

	const delay = min + Math.floor(Math.random() * (max - min + 1)); // "+ 1" means "maxMs" is included.
	return new Promise(resolve => setTimeout(resolve, delay));
}

function InitializeReopenMessages()
{
	REOPEN_REQUEST_MESSAGES =
	[
		"REOPEN @DunkOrSlum",
		"Dunk, I was late. Can you reopen please? @DunkOrSlum",
		"Can you reopen the bets please? @DunkOrSlum",
		"For this one time, can you please open the bets again? @DunkOrSlum",
		"I have just woke up. Sorry being late. Can you reopen? @DunkOrSlum",
		"Just returned from work. I apologize for being late. Can you please reopen? @DunkOrSlum"
	];
}

function GetARandomReopenMessage()
{
	if (!Array.isArray(REOPEN_REQUEST_MESSAGES) || REOPEN_REQUEST_MESSAGES.length === 0)
	{
		return "REOPEN @DunkOrSlum";
	}
	
	let i = Math.floor(Math.random() * REOPEN_REQUEST_MESSAGES.length);
	if (REOPEN_REQUEST_MESSAGES.length > 1)
	{
		while (i === LastReopenIndex)
		{
			i = Math.floor(Math.random() * REOPEN_REQUEST_MESSAGES.length);
		}
	}
	
	LastReopenIndex = i;
	return REOPEN_REQUEST_MESSAGES[i];
}
