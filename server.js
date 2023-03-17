const axios = require('axios');
const ccxt = require('ccxt');
const indicators = require('trading-indicator');
const WebSocket = require('ws');
const { MongoClient } = require('mongodb');
const TelegramBot = require('node-telegram-bot-api');
const bot = new TelegramBot('6085540527:AAH9YZ-eMrxIbJIhnB3BvLDn3JLQ_B8HxE8', { polling: false });


const uri = 'mongodb+srv://yusifdhrgam:Qwertly123@cluster0.eatwyhc.mongodb.net/test';
const client = new MongoClient(uri);

async function connectToDatabase() {
  await client.connect();
  return client.db('mydb');
}

async function sendTelegramMessage(message) {
    try {
      await bot.sendMessage('@analyt_trading_bot', message);
    } catch (error) {
      console.error('Error sending message to Telegram:', error);
    }
  }
  

const binance = new ccxt.binance();
alerts = require('trading-indicator').alerts
const messageQueue = [];

async function getSymbols() {
  const response = await axios.get('https://api3.binance.com/api/v3/ticker/price');
  return response.data.map((x) => x.symbol);
}

async function delay() {
  return new Promise((resolve) => setTimeout(resolve));
}

const calculateRSI = async (symbol) => {
  try {
    return await indicators.rsiCheck(
      14,
      80,
      20,
      'binance',
      symbol,
      '1h',
      false
    );
  } catch (err) {
    return err;
  }
};

const cross = async (symbol) => {
  try {
    return await indicators.maCross(50, 200, 'binance', symbol, '1h', false);
  } catch (err) {
    return err;
  }
};

async function getTradeSignal(symbol) {
  const rsi = await calculateRSI(symbol);

  if (rsi.overSold) {
    return 'rsi is oversold so buy';
  } else if (rsi.overBought) {
    return 'rsi is overbuy so sell';
  } else {
    return `wait`;
  }
}

async function getTradeSignalcross(symbol) {
  const crosss = await cross(symbol);

  if (crosss.goldenCross) {
    return 'goldenCross so buy';
  } else if (crosss.deathCross) {
    return 'deathCross so sell';
  } else {
    return `wait`;
  }
}

async function handleMessage(message, alertsCollection) {
    const data = JSON.parse(message);
    if (data.e === 'trade') {
      const symbol = data.s;
      const side = data.m ? 'sell' : 'buy';
      const price = parseFloat(data.p);
      const quantity = parseFloat(data.q);
      const tradeValue = price * quantity;
      const volume24h = await binance.fetchTicker(symbol);
      const threshold = volume24h.quoteVolume * 0.02;
      const tradeSignal = await getTradeSignal(symbol);
      const getcross = await getTradeSignalcross(symbol);
  
      if (tradeValue >= threshold) {
        console.log(
          `Symbol: ${symbol}, Side: ${side}, Price: ${price}, Quantity: ${quantity}, Trade Value: ${tradeValue} : ${threshold} : ${volume24h.quoteVolume}`
        );
  
        if (side === 'buy' && (tradeSignal === 'rsi is oversold so buy' || getcross === 'goldenCross so buy')) {
          const buyQuantity = parseFloat(data.q) * parseFloat(data.p);
          const orderSize = buyQuantity / volume24h.quoteVolume;
          const firstPrice = price;
          const totalBuy = buyQuantity;
          const totalVolume = volume24h.quoteVolume;
          const firstAlertDate = new Date();
          const firstAlertVolume24h = volume24h.quoteVolume;
  
          const dataToUpdate = {
            $setOnInsert: { symbol, firstPrice, firstAlertDate, firstAlertVolume24h, isOpen: true },
            $set: { currentPrice: price },
            $inc: { alertNumber: 1, buyQuantity, totalBuy },
          };
  
          const openSignal = await alertsCollection.findOne({ symbol, isOpen: true });
  
          if (!openSignal) {
            await alertsCollection.insertOne({
              symbol,
              alertNumber: 1,
              buyQuantity,
              totalBuy,
              firstPrice,
              currentPrice: price,
              firstAlertDate,
              firstAlertVolume24h,
              isOpen: true,
            });
          } else {
            await alertsCollection.updateOne({ symbol, isOpen: true }, dataToUpdate);
          }
  
          const updatedDoc = await alertsCollection.findOne({ symbol, isOpen: true });
  
          const alertMessage = await buildAlertMessage(
            symbol,
            side,
            updatedDoc.alertNumber,
            buyQuantity,
            price,
            volume24h,
            updatedDoc.firstPrice,
            updatedDoc.totalBuy,
            totalVolume,
            updatedDoc.firstAlertDate,
            updatedDoc.firstAlertVolume24h
          );
  
          console.log(alertMessage);
          await sendTelegramMessage(alertMessage);
        } else if (side === 'sell' && (tradeSignal === 'rsi is overbuy so sell' || getcross === 'deathCross so sell')) {
          const sellAlertMessage = `Sell alert for ${symbol}:\nPrice: ${price}\nQuantity: ${quantity}\nTrade Value: ${tradeValue}\nTrade Signal: ${tradeSignal}\nCross Signal: ${getcross}`;
  
          console.log(sellAlertMessage);
          await sendTelegramMessage(sellAlertMessage);
  
          await alertsCollection.updateOne(
            { symbol, isOpen: true },
            {
              $set: {
                isOpen: false,
              },
            }
          );
        }
      }
    }
  }
  
  

async function buildAlertMessage(
  symbol,
  side,
  alertNumber,
  buyQuantity,
  price,
  volume24h,
  firstPrice,
  totalBuy,
  totalVolume,
  firstAlertDate,
  firstAlertVolume24h
) {
  const volumeChange = ((volume24h.quoteVolume - firstAlertVolume24h) / firstAlertVolume24h) * 100;
  const lossOrProfit = ((price - firstPrice) / firstPrice) * 100;

  const volumeChangeSymbol = volumeChange >= 0 ? '🟢' : '🔴';
  const lossOrProfitSymbol = lossOrProfit >= 0 ? '🟢' : '🔴';
  const tradeSignal = await getTradeSignal(symbol);
  const getcross = await getTradeSignalcross(symbol);

  const alertMessage = `▁ ▂ ▄ ▅ ▆ ▇ █ 𝓪𝓷𝓪𝓵𝔂𝓽 █ ▇ ▆ ▅ ▄ ▂ ▁\n ┌ ♐ ${side === 'buy' ? '🟢' : '🔴'} ${symbol} [📳 ${alertNumber}] [\$${formatNumber(buyQuantity)}] \n ├ 𝐏𝐫𝐢𝐜𝐞: ${formatNumber(price)} \n ├ 𝐕𝐨𝐥: ${formatNumber(volumeChange)}% \n ├ ${volumeChangeSymbol} 𝐁𝐮𝐲𝐢𝐧𝐠 𝐏𝐫𝐢𝐜𝐞: ${formatNumber(firstPrice)} [${formatNumber(lossOrProfit)}%] \n ├ ${lossOrProfitSymbol} 𝗧𝗼𝘁𝗮𝗹 𝗯𝘂𝘆: \$${formatNumber(totalBuy)} \n ├ 𝐕𝐨𝐥𝐮𝐦𝐞 first time: \$${formatNumber(firstAlertVolume24h)} \n ├ Σ 𝐕𝐨𝐥𝐮𝐦𝐞 now: \$${formatNumber(totalVolume)} [${formatNumber(volumeChange)}%] ${volumeChangeSymbol} \n ├ rsi status: ${tradeSignal} \n ├ gold or death cross: ${getcross} \n └ 𝗙𝗶𝗿𝘀𝘁 𝐭𝐢𝐦𝐞 𝐀𝐥𝐞𝐫𝐭: ${firstAlertDate.toLocaleString()}`;

  return alertMessage;
}

function formatNumber(num) {
  return num.toFixed(2).replace(/(\d)(?=(\d{3})+(?!\d))/g, '$1,');
}

async function processMessageQueue(alertsCollection) {
  while (true) {
    if (messageQueue.length > 0) {
      const message = messageQueue.shift();
      await handleMessage(message, alertsCollection);
    }
    await delay();
  }
}

async function main() {
  const db = await connectToDatabase();
  const alertsCollection = db.collection('alerts');
  const symbols = await getSymbols();
  const usdtSymbols = symbols.filter((symbol) => symbol.endsWith('USDT'));

  const ws = new WebSocket('wss://stream.binance.com:9443/ws');

  ws.on('open', () => {
    ws.send(
      JSON.stringify({
        method: 'SUBSCRIBE',
        params: usdtSymbols.map((symbol) => symbol.toLowerCase() + '@trade'),
        id: 1,
      })
    );
  });

  ws.on('message', (message) => {
    messageQueue.push(message);
  });

  ws.on('close', () => {
    console.log('WebSocket closed. Reconnecting...');
    main();
  });

  ws.on('error', (err) => {
    console.error('WebSocket error: ', err);
  });

  await processMessageQueue(alertsCollection);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

