/**
 * Bot Shop don gian - chi hien QR khi chon mua
 */
const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

const BOT_TOKEN = process.env.BOT_TOKEN || '9131951452:AAF5vKlpd4fZQd94ww6KEABiHJiT-gBKDAs';
const BIN_ID = process.env.BIN_ID || '6b041f24ffd5d16053d776ed';
const MASTER_KEY = process.env.MASTER_KEY || '$2a$10$E3TfVjjxGA2Dy1881YzVOO.kjLRnQigWfUWmK5vj3Ny8h2gCbTl9e';

const BANK_BIN = '970454';
const BANK_ACCOUNT = '99ZP26154M42407211';
const BANK_NAME = 'ZALOPAY_PHAM THI HUE';

const API = `https://api.jsonbin.io/v3/b/${BIN_ID}`;

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
console.log('Bot started');

async function getData() {
  const res = await fetch(API + '/latest', {
    headers: { 'X-Master-Key': MASTER_KEY }
  });
  if (!res.ok) throw new Error('JSONBin loi ' + res.status);
  const json = await res.json();
  return json.record || { products: [], orders: [] };
}

async function saveData(data) {
  const res = await fetch(API, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Master-Key': MASTER_KEY,
      'X-Bin-Versioning': 'false'
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Luu JSONBin loi ' + res.status);
}

function formatMoney(n) {
  return new Intl.NumberFormat('vi-VN').format(n) + 'd';
}

function makeOrderId() {
  return 'DH' + Date.now().toString().slice(-8);
}

function vietQRUrl(amount, addInfo) {
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: addInfo,
    accountName: BANK_NAME
  });
  return `https://img.vietqr.io/image/${BANK_BIN}-${BANK_ACCOUNT}-compact2.png?${params.toString()}`;
}

// /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 'Chao ban! Gui /shop de xem san pham.');
});

// /setadmin
bot.onText(/\/setadmin/, async (msg) => {
  try {
    const data = await getData();
    data.config = data.config || {};
    data.config.adminChatId = msg.chat.id;
    await saveData(data);
    bot.sendMessage(msg.chat.id, 'Da set admin: ' + msg.chat.id);
  } catch (e) {
    bot.sendMessage(msg.chat.id, 'Loi: ' + e.message);
  }
});

// /shop
bot.onText(/\/shop/, async (msg) => {
  try {
    const data = await getData();
    const products = (data.products || []).filter(p => p.types && p.types.some(t => t.stock > 0));

    if (!products.length) {
      return bot.sendMessage(msg.chat.id, 'Chua co san pham.');
    }

    const keyboard = products.map(p => [{
      text: p.name,
      callback_data: 'p|' + p.id
    }]);

    await bot.sendMessage(msg.chat.id, 'Chon san pham:', {
      reply_markup: { inline_keyboard: keyboard }
    });
  } catch (e) {
    bot.sendMessage(msg.chat.id, 'Loi shop: ' + e.message);
  }
});

// Callback
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const dataCb = query.data || '';
  const from = query.from;

  try {
    // Chon san pham
    if (dataCb.startsWith('p|')) {
      const productId = dataCb.slice(2);
      const data = await getData();
      const product = (data.products || []).find(p => p.id === productId);

      if (!product) {
        return bot.answerCallbackQuery(query.id, { text: 'Khong tim thay SP' });
      }

      const types = (product.types || []).filter(t => t.stock > 0);
      if (!types.length) {
        return bot.answerCallbackQuery(query.id, { text: 'Het hang' });
      }

      const keyboard = types.map(t => [{
        text: t.name + ' - ' + formatMoney(t.price),
        callback_data: 't|' + productId + '|' + t.id
      }]);
      keyboard.push([{ text: '<< Quay lai', callback_data: 'back' }]);

      await bot.editMessageText(product.name + '\nChon loai:', {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: keyboard }
      });
      return bot.answerCallbackQuery(query.id);
    }

    // Quay lai
    if (dataCb === 'back') {
      const data = await getData();
      const products = (data.products || []).filter(p => p.types && p.types.some(t => t.stock > 0));
      const keyboard = products.map(p => [{
        text: p.name,
        callback_data: 'p|' + p.id
      }]);
      await bot.editMessageText('Chon san pham:', {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: { inline_keyboard: keyboard }
      });
      return bot.answerCallbackQuery(query.id);
    }

    // Chon loai -> tao don + gui QR
    if (dataCb.startsWith('t|')) {
      const parts = dataCb.split('|');
      const productId = parts[1];
      const typeId = parts[2];

      await bot.answerCallbackQuery(query.id, { text: 'Dang tao don...' });

      const data = await getData();
      const product = (data.products || []).find(p => p.id === productId);
      if (!product) {
        return bot.sendMessage(chatId, 'San pham khong ton tai');
      }
      const type = (product.types || []).find(t => t.id === typeId);
      if (!type || type.stock < 1) {
        return bot.sendMessage(chatId, 'Het hang');
      }

      const orderId = makeOrderId();
      let paymentNote = 'Lay SP ' + product.name + ' + ' + type.name + ' + ' + type.price;
      if (paymentNote.length > 50) {
        paymentNote = 'Lay SP ' + product.name.slice(0, 12) + ' + ' + type.name.slice(0, 8) + ' + ' + type.price;
      }

      // Luu don
      if (!data.orders) data.orders = [];
      data.orders.push({
        id: orderId,
        userId: from.id,
        username: from.username || '',
        fullName: [from.first_name, from.last_name].filter(Boolean).join(' '),
        productId: productId,
        productName: product.name,
        typeId: typeId,
        typeName: type.name,
        price: type.price,
        status: 'pending',
        paymentNote: paymentNote,
        createdAt: new Date().toISOString()
      });
      await saveData(data);

      // Tao link QR
      const qrUrl = vietQRUrl(type.price, paymentNote);

      const text =
        'Don hang ' + orderId + '\n' +
        'San pham: ' + product.name + '\n' +
        'Loai: ' + type.name + '\n' +
        'So tien: ' + formatMoney(type.price) + '\n\n' +
        'Noi dung CK: ' + paymentNote + '\n\n' +
        'Quet ma QR ben duoi de thanh toan.\n' +
        'Sau khi chuyen xong bam nut Da thanh toan.';

      // Gui anh QR
      try {
        await bot.sendPhoto(chatId, qrUrl, {
          caption: text,
          reply_markup: {
            inline_keyboard: [[
              { text: 'Da thanh toan', callback_data: 'paid|' + orderId }
            ]]
          }
        });
      } catch (e) {
        // Neu gui anh loi thi gui link
        await bot.sendMessage(chatId, text + '\n\nLink QR:\n' + qrUrl, {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Da thanh toan', callback_data: 'paid|' + orderId }
            ]]
          }
        });
      }

      // Xoa tin nhan cu
      try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}

      return;
    }

    // Bam Da thanh toan
    if (dataCb.startsWith('paid|')) {
      const orderId = dataCb.slice(5);
      const data = await getData();
      const order = (data.orders || []).find(o => o.id === orderId);

      if (!order) {
        return bot.answerCallbackQuery(query.id, { text: 'Khong tim thay don' });
      }
      if (order.userId !== from.id) {
        return bot.answerCallbackQuery(query.id, { text: 'Khong phai don cua ban' });
      }
      if (order.status !== 'pending') {
        return bot.answerCallbackQuery(query.id, { text: 'Don da xu ly' });
      }

      order.status = 'waiting_confirm';
      await saveData(data);

      await bot.answerCallbackQuery(query.id, { text: 'Da gui yeu cau' });

      await bot.sendMessage(chatId,
        'Ban da bao Da thanh toan.\n\n' +
        'Vui long cho it phut, admin se xac nhan don hang va tra key ve cho ban.'
      );

      // Bao admin
      const adminId = data.config && data.config.adminChatId;
      if (adminId) {
        try {
          await bot.sendMessage(adminId,
            'Khach bao da thanh toan\n' +
            'Ma: ' + orderId + '\n' +
            order.productName + ' - ' + order.typeName + '\n' +
            formatMoney(order.price) + '\n' +
            'Noi dung: ' + order.paymentNote
          );
        } catch (e) {}
      }
      return;
    }

  } catch (err) {
    console.error(err);
    try {
      await bot.answerCallbackQuery(query.id, { text: 'Loi: ' + (err.message || 'unknown').slice(0, 40) });
    } catch (e) {}
    try {
      await bot.sendMessage(chatId, 'Loi: ' + (err.message || err));
    } catch (e) {}
  }
});

bot.on('polling_error', (err) => {
  console.error('Polling:', err.message);
});

console.log('Bot ready');
