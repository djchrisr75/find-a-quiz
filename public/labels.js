/* Find a Quiz: the options a listing can have, and how they read. Shared by the server and the pages. */
(function (root) {
  var L = {
    TYPES: {
      general: 'General knowledge', music: 'Music', picture: 'Picture round', film: 'Film & TV', sport: 'Sport',
      history: 'History', science: 'Science & nature', themed: 'Themed nights', bingo: 'Bingo', jackpot: 'Jackpot / rollover',
      charity: 'Charity quiz', race: 'Race night', comedy: 'Comedy', kids: "Kids' quiz", language: 'Not in English',
    },
    FORMATS: { paper: 'Pen & paper', app: 'Played on phones (app)', tablets: 'Tablets provided', screen: 'Big screen', online: 'Online / Zoom' },
    AGES: { all: 'All ages', family: 'Family friendly', '10': '10+', '12': '12+', '16': '16+', '18': '18+ only', '21': '21+ only' },
    FEATURES: {
      food: 'Food served', accessible: 'Step-free access', parking: 'Parking', dogs: 'Dog friendly', garden: 'Beer garden',
      transport: 'Near public transport', wifi: 'Free Wi-Fi', veggie: 'Veggie food',
    },
    PRIZES: { cash: 'Cash', bartab: 'Bar tab', vouchers: 'Vouchers', jackpot: 'Jackpot', trophy: 'Trophy', charity: 'For charity' },
    CURRENCIES: ['GBP', 'EUR', 'USD', 'AUD', 'CAD', 'NZD', 'ZAR', 'INR', 'SGD', 'AED', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY'],
    // ISO country codes, for the country picker (names come from the browser in the visitor's language)
    COUNTRIES: ('GB IE US CA AU NZ ES FR DE IT PT NL BE LU CH AT DK SE NO FI IS PL CZ SK HU RO BG GR CY MT HR SI EE LV LT ' +
      'TR AE QA BH OM KW SA IL EG MA TN ZA KE NG GH IN LK SG MY TH VN PH ID HK TW JP KR CN MX BR AR CL CO PE UY CR PA DO ' +
      'JM BB BS TT BM GI IM JE GG FK').split(' '),
  };

  // "Free", "£2 per person", "€10 per team"
  L.feeText = function (fee) {
    if (!fee) return '';
    if (fee.free) return 'Free';
    if (fee.text) return fee.text;
    if (fee.amount == null || fee.amount === '') return '';
    var n = Number(fee.amount), s;
    try { s = new Intl.NumberFormat('en-GB', { style: 'currency', currency: fee.currency || 'GBP', minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(n); }
    catch (e) { s = n.toFixed(2) + ' ' + (fee.currency || ''); }
    return s + ' per ' + (fee.per === 'team' ? 'team' : 'person');
  };
  L.countryName = function (code) {
    try { return new Intl.DisplayNames(['en-GB'], { type: 'region' }).of(code) || code; } catch (e) { return code; }
  };

  if (typeof module === 'object' && module.exports) module.exports = L; else root.FAQLabels = L;
})(this);
