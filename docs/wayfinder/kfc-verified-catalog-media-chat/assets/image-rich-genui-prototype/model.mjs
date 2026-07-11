const media = (mediaKey, entityId, url, altText, entityType = 'menu_item') =>
  Object.freeze({
    mediaKey,
    entityType,
    entityId,
    url,
    altText,
    mimeType: 'image/jpeg',
  });

export const prototypeData = Object.freeze({
  menu: [
    {
      id: '2945',
      name: 'Xô Zòn Zã 159K',
      description: 'Xô 5 Miếng Gà giá ưu đãi',
      priceVnd: 159000,
      media: media(
        'kfcvn:item-image:fs-bucket5cob',
        '2945',
        'https://static.kfcvietnam.com.vn/images/items/lg/FS-BUCKET5COB.jpg?v=4lmbjg',
        'Xô Zòn Zã 159K của KFC',
      ),
    },
    {
      id: 'tieutungchill',
      name: 'Combo Tiêu Tung Chill 85K',
      description: 'Combo gà lắc tiêu chanh',
      priceVnd: 85000,
      media: media(
        'kfcvn:item-image:tieutungchill',
        'tieutungchill',
        'https://static.kfcvietnam.com.vn/images/items/lg/TIEUTUNGCHILL.jpg?v=4lmbjg',
        'Combo Tiêu Tung Chill 85K của KFC',
      ),
    },
    {
      id: 'd-chicken-1',
      name: 'Combo 1 Miếng Gà',
      description: '1 Miếng gà, khoai tây chiên và Pepsi',
      priceVnd: 59000,
      media: media(
        'kfcvn:item-image:d-chicken-1',
        'd-chicken-1',
        'https://static.kfcvietnam.com.vn/images/items/lg/D-CHICKEN-1.jpg?v=4lmbjg',
        'Combo 1 Miếng Gà của KFC',
      ),
    },
    {
      id: 'burger-flava',
      name: 'Burger Phi-lê Gà Quay',
      description: 'Burger với phi-lê gà quay',
      priceVnd: 56000,
      media: media(
        'kfcvn:item-image:burger-flava',
        'burger-flava',
        'https://static.kfcvietnam.com.vn/images/items/lg/Burger-Flava.jpg?v=4lmbjg',
        'Burger Phi-lê Gà Quay của KFC',
      ),
    },
    {
      id: 'salad-sesame',
      name: 'Salad Xốt Mè Rang',
      description: 'Salad ăn nhẹ với xốt mè rang',
      priceVnd: 22000,
      media: media(
        'kfcvn:item-image:salad-xot-me-rang',
        'salad-sesame',
        'https://static.kfcvietnam.com.vn/images/items/lg/SALAD-XOT-ME-RANG.jpg?v=4lmbjg',
        'Salad Xốt Mè Rang của KFC',
      ),
    },
  ],
  modifier: {
    parentMedia: media(
      'kfcvn:item-image:3-fried-chicken',
      'three-chicken',
      'https://static.kfcvietnam.com.vn/images/items/lg/3-Fried-Chicken.jpg?v=4lmbjg',
      'Ba miếng gà KFC',
    ),
    options: [
      {
        id: 'hot-spicy',
        name: 'Gà Giòn Cay',
        media: media(
          'kfcvn:item-image:mod-ga-gion-cay',
          'hot-spicy',
          'https://static.kfcvietnam.com.vn/images/items/lg/MOD-Ga-Gion-Cay.jpg?v=4lmbjg',
          'Lựa chọn Gà Giòn Cay của KFC',
          'modifier_option',
        ),
      },
      { id: 'no-media', name: 'Giữ lựa chọn hiện tại', media: null },
    ],
  },
  promotions: [
    {
      id: 'lunch-2026',
      title: 'Trưa Nay Khỏi Nghĩ Nhiều',
      startDate: '2026-01-02',
      endDate: '2026-12-31',
      eligibility: '10:00–14:00, thứ Hai đến thứ Sáu',
      media: media(
        'kfcvn:promotion-image:lunch-2026',
        'lunch-2026',
        'https://static.kfcvietnam.com.vn/TIN%20KHUYEN%20MAI%20-%20TNAG%20PHASE%203.jpg',
        'Khuyến mãi bữa trưa KFC năm 2026',
        'promotion_campaign',
      ),
    },
    {
      id: 'big-order-july-2026',
      title: 'Thêm Gà, Tiệc Thêm Vui',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      eligibility: 'Áp dụng cho đơn hàng lớn',
      media: media(
        'kfcvn:promotion-image:big-order-july-2026',
        'big-order-july-2026',
        'https://static.kfcvietnam.com.vn/710x470%20-%20BO%20T7.jpg',
        'Khuyến mãi đơn hàng lớn KFC tháng 7 năm 2026',
        'promotion_campaign',
      ),
    },
    {
      id: 'expired-march-2026',
      title: 'Gà Giòn Thay Hoa',
      startDate: '2026-03-01',
      endDate: '2026-03-31',
      eligibility: 'Đã hết hạn',
      media: null,
    },
  ],
  cart: {
    items: [
      {
        entityId: '2945',
        name: 'Xô Zòn Zã 159K',
        category: 'main',
        quantity: 1,
      },
      {
        entityId: 'pepsi',
        name: 'Pepsi',
        category: 'drink',
        quantity: 2,
      },
    ],
  },
});

export function discoveryItems(items) {
  return items.slice(0, 5);
}

export function updateMenuQuantity(quantities, itemCode, delta) {
  const next = new Map(
    quantities instanceof Map ? quantities : Object.entries(quantities),
  );
  const current = Number(next.get(itemCode) ?? 0);
  next.set(itemCode, Math.max(0, Math.min(99, current + delta)));
  return next;
}

export function selectedMenuLines(items, quantities) {
  const values =
    quantities instanceof Map ? quantities : new Map(Object.entries(quantities));
  return items.flatMap((item) => {
    const quantity = Number(values.get(item.id) ?? 0);
    return quantity > 0 ? [{ itemCode: item.id, quantity }] : [];
  });
}

export function modifierHero(modifier, selectedOptionId) {
  return (
    modifier.options.find((option) => option.id === selectedOptionId)?.media ??
    modifier.parentMedia
  );
}

export function cartHero(items, persistedMediaKey) {
  if (persistedMediaKey) {
    return (
      prototypeData.menu
        .map((item) => item.media)
        .find((entry) => entry?.mediaKey === persistedMediaKey) ?? null
    );
  }
  const firstMain = items.find((item) => item.category === 'main');
  return (
    prototypeData.menu.find((item) => item.id === firstMain?.entityId)?.media ??
    null
  );
}

export function activePromotionCards(promotions, asOfDate) {
  return promotions.filter(
    (promotion) =>
      promotion.startDate <= asOfDate && promotion.endDate >= asOfDate,
  );
}

export function mediaFrameState(mediaValue, state) {
  if (!mediaValue || state === 'failed') {
    return { status: 'collapsed', media: mediaValue };
  }
  return { status: state, media: mediaValue };
}
