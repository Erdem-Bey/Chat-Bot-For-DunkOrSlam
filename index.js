import tmi from "tmi.js";
import dotenv from "dotenv";
dotenv.config();

/******************
* SCRIPT BEHAVIOR *
******************/

// Vote in the bets
const VOTE_FOR_TI = false;
const VOTE_FOR_DAILY = false;
const VOTE_OF_TI = "!no";
const VOTE_OF_DAILY = "!yes";

// Request to reopen the bet after the bet is closed.
const EnableReopenRequest = false;

// Every time the shop is opened, the code will buy an item from `SHOP_ITEMS_TO_BUY` in order.
// Example array initializations: [], [1], [2], [5, 2, 1];
const SHOP_ITEMS_TO_BUY = [1];
var ShopItemToBuyIndex = 0;

/***********************************
* REFRESH OAUTH TOKEN IF NECESSARY *
***********************************/

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

await ensureValidToken();

/***********************
* TMI.JS COMMUNICATION *
***********************/

const CHANNEL = (process.env.CHANNEL || "dunkorslam").toLowerCase();

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

process.on("SIGINT", () =>
{
	ConsoleLog_WithDate(LFG_WHITE, BG_RED, `Disconnecting…`);
	client.disconnect();
	process.exit();
});

client.on("connected", () =>
{
	InitializeReopenMessages();
	
	ConsoleLog_WithDate(LFG_WHITE, BG_GREEN, `Connected. Listening for chat messages…`);
	
	if (BE_Enable === true)
	{
		BE_Run().catch(console.error);
	}
});

/*******************
* PROCESS MESSAGES *
*******************/

const WIZEBOT_NAME = "wizebot";
const DUNKORSLAM_NAME = "dunkorslam";
const DUNKBOT_NAME = "dunkbot";
const WIZEBOT_MSG_BEGIN_RESUB = "⭐️ RE-SUB ⭐️";
const WIZEBOT_MSG_BEGIN_NEWSUB = "⭐️ NEW SUB ⭐️";
const WIZEBOT_MSG_END_GIFT = "to the community!";
const MIN_IDIOT_GAP_MS = 300_000;	// minimal gap between replies to idiots
const DUP_WINDOW_MS = 30_000;		// Twitch duplicate window

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
		else if (message == "!uguu")
		{
			ConsoleLog_WithDate(LFG_YELLOW, BG_BLACK, `!uguu (from: ${from})`);
		}
		else if (message == "!magikarp")
		{
			ConsoleLog_WithDate(LFG_BLACK, BG_BLACK, `!magikarp (from: ${from})`);
		}
	}
});

client.connect().catch(console.error);

async function processMessagesFrom_Dunk(channel, dunkName, message)
{
	// Dunk rarely types messages to chat.
	// I don't want to miss them, so I will print them to my console.
	ConsoleLog_WithDate(LFG_BLUE, LBG_WHITE, `Dunk's Message: "${message}"`);
	
	// Dunk opens the shop with this message.
	// He types this message once in two hours, so I don't need a repition check here.
	if (message === "!open")
	{
		// I want to immediately buy the 2nd item in the shop. I don't want any delay.
		if (ShopItemToBuyIndex < SHOP_ITEMS_TO_BUY.length)
		{
			ConsoleLog_WithDate(FG_BLUE, BG_BLACK, `Buying item from shop: "${SHOP_ITEMS_TO_BUY[ShopItemToBuyIndex]}"`);
			await ClientSay(channel, `!deposit ${SHOP_ITEMS_TO_BUY[ShopItemToBuyIndex]}`);
			ShopItemToBuyIndex++;
		}
		else
		{
			ConsoleLog_WithDate(FG_GREEN, BG_BLACK, `The shop is open, but there is nothing to buy in the list.`);
		}
	}
	else if (message === "!NoMore")
	{
		if (EnableReopenRequest === true)
		{
			await Delay(2000, 5000);
			await ClientSay(channel, GetARandomReopenMessage());
		}
	}
	else if (message.startsWith("!DoYou? Noita Soler TI"))
	{
		if (VOTE_FOR_TI === true)
		{
			await Delay(20000, 30000);
			await ClientSay(channel, VOTE_OF_TI);
		}
	}
	else if (message.startsWith("!DoYou? Daily"))
	{
		if (VOTE_FOR_DAILY === true)
		{
			await Delay(20000, 30000);
			await ClientSay(channel, VOTE_OF_DAILY);
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
		
		if (willReplyToWizeBot === true)
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
			await ClientSay(channel, text);
			// Record last reply time.
			lastReplyToWizeBot = Date.now();
			// Log to the console.
			ConsoleLog_WithDate(FG_WHITE, BG_BLACK, `Replied to WizeBot message [${subType}] : "${text}"`);
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
		ConsoleLog_WithDate(FG_WHITE, BG_BLACK, `WizeBot: "${message}"`);
	}
}

async function processMessagesFrom_DunkBot(channel, dunkBotName, message, tags)
{
	if (message === "Anti-Weeb measures engaged!")
	{
		await Delay(0, 1000);
		await ClientSay(channel, `AYAYA We will return... AYAYA`);
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
		await ClientSay(channel, `${BASE} (I was fooled by an idiot!)`);
		// Record last reply time.
		lastReplyToIdiot = Date.now();
		// Log to the console.
		ConsoleLog_WithDate(LFG_BLACK, BG_BLACK, `Replied to idiot: "${idiotName}"`);
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

/*********************
* BET REOPEN REQUEST *
*********************/

// Bet reopen request
var REOPEN_REQUEST_MESSAGES;
var LastReopenIndex = -1;

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

/*************************
* BALD ENERGY RANK BOOST *
*************************/

// Appearantly Dunk can see these messages and this creates inconvenience.
// Please don't use this part or you will get banned.

/*var BE_Enable			= false;
var BE_EnableUguu		= true;
var BE_EnableMagikarp	= true;
var BE_EnablePunch		= true;
var BE_CountUguu		= 0;
var BE_CountMagikarp	= 0;
var BE_CountPunch		= 0;
const BE_WeightUguu		= 0.4;
const BE_WeightMagikarp	= 0.1;
const BE_WeightPunch	= 0.9;

async function BE_Run()
{
	await Delay(10000, 10000);
	
	while (true)
	{
		if (BE_EnableUguu)
		{
			if (Math.random() < BE_WeightUguu)
			{
				await ClientSay_ToDefaultChannel(`!uguu`);
				ConsoleLog_WithDate(LFG_YELLOW, BG_BLACK, `[${BE_CountUguu}] !uguu`);
				BE_CountUguu++;
				await Delay(30000, 60000);
			}
		}
		
		if (BE_EnableMagikarp)
		{
			if (Math.random() < BE_WeightMagikarp)
			{
				await ClientSay_ToDefaultChannel(`!magikarp`);
				ConsoleLog_WithDate(FG_WHITE, BG_BLACK, `[${BE_CountMagikarp}] !magikarp`);
				BE_CountMagikarp++;
				await Delay(30000, 60000);
			}
		}
		
		if (BE_EnablePunch)
		{
			if (Math.random() < BE_WeightPunch)
			{
				await ClientSay_ToDefaultChannel(`!punch`);
				ConsoleLog_WithDate(LFG_BLACK, BG_BLACK, `[${BE_CountPunch}] !punch`);
				BE_CountPunch++;
				await Delay(30000, 60000);
			}
		}
		
		// Prevent tight loop when both are false.
		if (!BE_EnableUguu && !BE_EnableMagikarp && !BE_EnablePunch)
		{
			await Delay(600000, 600000);
		}
	}
}*/

/********************
* HELPFUL FUNCTIONS *
********************/

async function ClientSay_ToDefaultChannel(message)
{
	await ClientSay(CHANNEL, message);
}

async function ClientSay(channel, message)
{
	const ch = channel.startsWith("#") ? channel : `#${channel}`;
	await client.say(ch, message);
}

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

/**************************
* COLORFUL CONSOLE OUTPUT *
**************************/

// Style
const RESET			= "\x1b[0m";
const BOLD_ON		= "\x1b[1m";
const UNDERLINE_ON	= "\x1b[4m";
const BLINK_ON		= "\x1b[5m";
const BOLD_OFF		= "\x1b[21m";
const UNDERLINE_OFF	= "\x1b[24m";
const BLINK_OFF		= "\x1b[25m";

// Normal Foreground Colors
const FG_BLACK		= "\x1b[30m";
const FG_RED		= "\x1b[31m";
const FG_GREEN		= "\x1b[32m";
const FG_YELLOW		= "\x1b[33m";
const FG_BLUE		= "\x1b[34m";
const FG_MAGENTA	= "\x1b[35m";
const FG_CYAN		= "\x1b[36m";
const FG_WHITE		= "\x1b[37m";
const FG_DEFAULT	= "\x1b[39m";

// Light Foreground Colors
const LFG_BLACK		= "\x1b[90m";
const LFG_RED		= "\x1b[91m";
const LFG_GREEN		= "\x1b[92m";
const LFG_YELLOW	= "\x1b[93m";
const LFG_BLUE		= "\x1b[94m";
const LFG_MAGENTA	= "\x1b[95m";
const LFG_CYAN		= "\x1b[96m";
const LFG_WHITE		= "\x1b[97m";

// Normal Background Colors
const BG_BLACK    	= "\x1b[40m";
const BG_RED    	= "\x1b[41m";
const BG_GREEN  	= "\x1b[42m";
const BG_YELLOW 	= "\x1b[43m";
const BG_BLUE   	= "\x1b[44m";
const BG_MAGENTA	= "\x1b[45m";
const BG_CYAN		= "\x1b[46m";
const BG_WHITE		= "\x1b[47m";
const BG_DEFAULT	= "\x1b[49m";

// Light Background Colors
const LBG_BLACK    	= "\x1b[100m";
const LBG_RED    	= "\x1b[101m";
const LBG_GREEN  	= "\x1b[102m";
const LBG_YELLOW 	= "\x1b[103m";
const LBG_BLUE   	= "\x1b[104m";
const LBG_MAGENTA	= "\x1b[105m";
const LBG_CYAN		= "\x1b[106m";
const LBG_WHITE		= "\x1b[107m";

function FG_RGB(r, g, b)
{
	return `\x1b[38;2;${r};${g};${b}m`;
}

function BG_RGB(r, g, b)
{
	return `\x1b[48;2;${r};${g};${b}m`;
}

function ConsoleLog_WithColor(fgcolor, bgcolor, text)
{
	console.log(fgcolor + bgcolor + text + RESET);
}

function ConsoleLog_WithDate(fgcolor, bgcolor, text)
{
	console.log(GetTime() + " " + fgcolor + bgcolor + text + RESET);
}
