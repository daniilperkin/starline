/**
 * Bundled story-structure templates (slice 16, decision 24 phase 2).
 *
 * Four shapes a novel can take, each expressed as the beats it is made of. A beat becomes one
 * scene: the title is the beat's name, the synopsis is what that beat is for. The templates are
 * deliberately generic craft descriptions — they say what happens structurally, not what happens
 * in *your* story — because the writer supplies the specifics when they edit the scenes.
 *
 * Content lives here rather than in the i18n catalogue: the catalogue holds interface chrome,
 * this is prose the writer reads and edits. A test asserts the two locales stay in step, beat for
 * beat, so a translation can never silently lag behind.
 */

export type TemplateId = "three-act" | "heros-journey" | "save-the-cat" | "story-circle";

export interface TemplateBeat {
  /** Becomes the scene title. Short — the writer will rename freely. */
  title: string;
  /** Becomes the scene synopsis: what this beat is for. */
  synopsis: string;
}

export interface TemplateContent {
  name: string;
  summary: string;
  beats: TemplateBeat[];
}

export const TEMPLATE_IDS: TemplateId[] = [
  "three-act",
  "heros-journey",
  "save-the-cat",
  "story-circle",
];

export const TEMPLATE_CONTENT: Record<TemplateId, Record<"en" | "uk", TemplateContent>> = {
  "three-act": {
    en: {
      name: "Three-act structure",
      summary: "Nine scenes: the classic setup, confrontation and resolution.",
      beats: [
        {
          title: "Opening image",
          synopsis:
            "Show the world and the protagonist as they are now, before anything changes — the 'before' the ending will answer.",
        },
        {
          title: "Inciting incident",
          synopsis:
            "Something arrives that cannot be ignored and sets the story's question. The protagonist has not chosen anything yet.",
        },
        {
          title: "First plot point",
          synopsis:
            "The protagonist commits. The door to the old life closes and the goal becomes concrete.",
        },
        {
          title: "Rising complications",
          synopsis:
            "First attempts fail and cost something. Allies and opposition both become clearer.",
        },
        {
          title: "Midpoint reversal",
          synopsis:
            "A truth lands — about the goal, an ally, or the protagonist themselves — and changes what winning means.",
        },
        {
          title: "Escalating pressure",
          synopsis: "The opposition stops holding back. Whatever worked before stops working.",
        },
        {
          title: "Second plot point",
          synopsis:
            "The lowest turn: the plan collapses, something precious is lost, and the protagonist sees what they must give up.",
        },
        {
          title: "Climax",
          synopsis:
            "The confrontation the whole story has aimed at. The protagonist acts on what they learned, at real cost.",
        },
        {
          title: "Resolution",
          synopsis:
            "The new world, briefly: what changed, what it cost, and the image that answers the opening.",
        },
      ],
    },
    uk: {
      name: "Триактна структура",
      summary: "Дев'ять сцен: класичні зав'язка, конфронтація і розв'язка.",
      beats: [
        {
          title: "Початковий образ",
          synopsis:
            "Покажіть світ і протагоніста такими, як вони є зараз, до будь-яких змін — те «до», на яке відповість фінал.",
        },
        {
          title: "Запалювальна подія",
          synopsis:
            "З'являється щось, що неможливо проігнорувати, і ставить головне питання історії. Протагоніст ще нічого не обрав.",
        },
        {
          title: "Перша поворотна точка",
          synopsis:
            "Протагоніст зобов'язується. Двері до старого життя зачиняються, і мета стає конкретною.",
        },
        {
          title: "Ускладнення",
          synopsis:
            "Перші спроби провалюються і чогось коштують. І союзники, і опір стають яснішими.",
        },
        {
          title: "Перелом середини",
          synopsis:
            "Відкривається правда — про мету, союзника або самого протагоніста — і змінює сенс перемоги.",
        },
        {
          title: "Зростання тиску",
          synopsis: "Опір перестає стримуватися. Те, що працювало раніше, більше не працює.",
        },
        {
          title: "Друга поворотна точка",
          synopsis:
            "Найнижчий поворот: план руйнується, втрачено щось дороге, і протагоніст бачить, від чого мусить відмовитися.",
        },
        {
          title: "Кульмінація",
          synopsis:
            "Конфронтація, до якої вела вся історія. Протагоніст діє за тим, що зрозумів, — із реальною ціною.",
        },
        {
          title: "Розв'язка",
          synopsis:
            "Новий світ, коротко: що змінилося, чого це коштувало і який образ відповідає початковому.",
        },
      ],
    },
  },

  "heros-journey": {
    en: {
      name: "Hero's Journey",
      summary: "Twelve scenes: Campbell's monomyth, stage by stage.",
      beats: [
        {
          title: "Ordinary world",
          synopsis:
            "The hero's everyday life, with its lacks and limits visible. Establish what normal costs them.",
        },
        {
          title: "Call to adventure",
          synopsis:
            "The disruption arrives: an invitation, a threat, a discovery that cannot be undone.",
        },
        {
          title: "Refusal of the call",
          synopsis:
            "The hero hesitates — fear, duty, or disbelief. Show why the ordinary world still holds them.",
        },
        {
          title: "Meeting the mentor",
          synopsis:
            "Someone or something gives the hero what they need to begin: knowledge, a tool, a push.",
        },
        {
          title: "Crossing the threshold",
          synopsis:
            "The hero commits and enters the unfamiliar world. The rules are different here and they don't know them yet.",
        },
        {
          title: "Tests, allies, enemies",
          synopsis:
            "The new world teaches through trials. Friends and foes declare themselves, and the hero learns the local rules.",
        },
        {
          title: "Approach to the inmost cave",
          synopsis:
            "Preparation and dread: the hero nears the thing they fear most, and the cost of failure becomes explicit.",
        },
        {
          title: "The ordeal",
          synopsis:
            "The central crisis. The hero faces death — literal or of an identity — and does not come through unchanged.",
        },
        {
          title: "The reward",
          synopsis:
            "The hero survives and takes the prize: an object, a truth, a reconciliation. It is never quite what they expected.",
        },
        {
          title: "The road back",
          synopsis:
            "The journey home, with consequences in pursuit. The old world is not waiting intact.",
        },
        {
          title: "Resurrection",
          synopsis:
            "The final test, at the highest stakes, where the hero proves the change is real — and pays for it.",
        },
        {
          title: "Return with the elixir",
          synopsis:
            "The hero comes home changed, carrying something that heals or frees the ordinary world.",
        },
      ],
    },
    uk: {
      name: "Подорож героя",
      summary: "Дванадцять сцен: мономіф Кемпбелла, етап за етапом.",
      beats: [
        {
          title: "Звичайний світ",
          synopsis:
            "Побут героя, у якому видно його брак і межі. Покажіть, чого коштує йому звичайне життя.",
        },
        {
          title: "Поклик до пригод",
          synopsis: "З'являється збурення: запрошення, загроза, відкриття, яке вже не скасувати.",
        },
        {
          title: "Відмова від поклику",
          synopsis:
            "Герой вагається — страх, обов'язок чи невіра. Покажіть, чому звичайний світ досі його тримає.",
        },
        {
          title: "Зустріч із наставником",
          synopsis: "Хтось або щось дає героєві потрібне для початку: знання, інструмент, поштовх.",
        },
        {
          title: "Перетин порогу",
          synopsis:
            "Герой зобов'язується і входить у незнаний світ. Тут інші правила, і він їх ще не знає.",
        },
        {
          title: "Випробування, союзники, вороги",
          synopsis:
            "Новий світ навчає через випробування. Друзі й вороги виявляють себе, і герой засвоює місцеві правила.",
        },
        {
          title: "Підхід до найглибшої печери",
          synopsis:
            "Підготовка і страх: герой наближається до того, чого боїться найбільше, і ціна поразки стає очевидною.",
        },
        {
          title: "Випробування смертю",
          synopsis:
            "Центральна криза. Герой стикається зі смертю — буквальною чи смертю власної сутності — і виходить звідти зміненим.",
        },
        {
          title: "Нагорода",
          synopsis:
            "Герой виживає і бере своє: предмет, правду, примирення. Це ніколи не зовсім те, чого він чекав.",
        },
        {
          title: "Дорога назад",
          synopsis:
            "Повернення додому, а наслідки женуться слідом. Старий світ не чекає його незмінним.",
        },
        {
          title: "Воскресіння",
          synopsis:
            "Останнє випробування, за найвищих ставок, де герой доводить, що зміна справжня, — і платить за неї.",
        },
        {
          title: "Повернення з еліксиром",
          synopsis:
            "Герой повертається додому зміненим, несучи те, що зцілює або звільняє звичайний світ.",
        },
      ],
    },
  },

  "save-the-cat": {
    en: {
      name: "Save the Cat",
      summary: "Fifteen scenes: Blake Snyder's beat sheet, beat for beat.",
      beats: [
        {
          title: "Opening image",
          synopsis:
            "A snapshot of the world before the story — the 'before' photo the final image will answer.",
        },
        {
          title: "Theme stated",
          synopsis:
            "Someone says, almost casually, what this story is actually about. The protagonist is not listening yet.",
        },
        {
          title: "Set-up",
          synopsis:
            "Introduce the cast and the six things that need fixing. Show the protagonist's life as unsatisfying in a specific way.",
        },
        {
          title: "Catalyst",
          synopsis:
            "The news, the knock, the discovery that breaks the ordinary day and cannot be unlearned.",
        },
        {
          title: "Debate",
          synopsis:
            "The protagonist argues with themselves or others: should they go? What do they risk by staying?",
        },
        {
          title: "Break into two",
          synopsis:
            "A deliberate choice to enter the new world. The story's question changes from 'what if' to 'what now'.",
        },
        {
          title: "B story",
          synopsis:
            "The relationship that carries the theme arrives — love, friendship, mentorship — and starts teaching what the plot cannot.",
        },
        {
          title: "Fun and games",
          synopsis:
            "The promise of the premise: the protagonist plays in the new world, succeeding enough to make the fall hurt.",
        },
        {
          title: "Midpoint",
          synopsis:
            "False victory or false defeat: the stakes rise, a clock starts, and the protagonist stops playing.",
        },
        {
          title: "Bad guys close in",
          synopsis:
            "The opposition tightens. Internal cracks and external pressure arrive together, and old allies fail.",
        },
        {
          title: "All is lost",
          synopsis:
            "The lowest point: the goal looks dead and something irreplaceable is gone. A whiff of death.",
        },
        {
          title: "Dark night of the soul",
          synopsis:
            "The protagonist sits in the wreckage. Let the theme, planted in the B story, surface and be understood.",
        },
        {
          title: "Break into three",
          synopsis:
            "The insight that makes a new plan possible: the A and B stories meet, and the protagonist chooses again.",
        },
        {
          title: "Finale",
          synopsis:
            "The plan executed, in rising stages: gather the team, storm the castle, face the worst, and win at cost.",
        },
        {
          title: "Final image",
          synopsis:
            "The mirror of the opening image, showing what has changed — proof that the story meant something.",
        },
      ],
    },
    uk: {
      name: "Save the Cat",
      summary: "П'ятнадцять сцен: біт-лист Блейка Снайдера, біт за бітом.",
      beats: [
        {
          title: "Початковий образ",
          synopsis: "Знімок світу до історії — те «до», на яке відповість фінальний образ.",
        },
        {
          title: "Озвучена тема",
          synopsis:
            "Хтось майже побіжно каже, про що насправді ця історія. Протагоніст ще не слухає.",
        },
        {
          title: "Зав'язка",
          synopsis:
            "Представте склад персонажів і шість речей, які треба виправити. Покажіть конкретну незадоволеність життям протагоніста.",
        },
        {
          title: "Каталізатор",
          synopsis:
            "Новина, стукіт у двері, відкриття, що розбиває звичайний день і вже не забувається.",
        },
        {
          title: "Сумніви",
          synopsis:
            "Протагоніст сперечається із собою чи іншими: чи йти? Що він втрачає, залишившись?",
        },
        {
          title: "Вхід у другу дію",
          synopsis:
            "Свідомий вибір увійти в новий світ. Питання історії змінюється з «а що як» на «а що тепер».",
        },
        {
          title: "Побічна лінія",
          synopsis:
            "З'являються стосунки, що несуть тему — кохання, дружба, наставництво, — і починають учити того, чого не навчить сюжет.",
        },
        {
          title: "Гра",
          synopsis:
            "Обіцянка задуму: протагоніст грається в новому світі й досягає достатньо, щоб падіння боліло.",
        },
        {
          title: "Середина",
          synopsis:
            "Хибна перемога або хибна поразка: ставки зростають, запускається відлік, і протагоніст перестає гратися.",
        },
        {
          title: "Вороги тиснуть",
          synopsis:
            "Опір стискається. Внутрішні тріщини й зовнішній тиск приходять разом, а старі союзники підводять.",
        },
        {
          title: "Усе втрачено",
          synopsis: "Найнижча точка: мета виглядає мертвою, і щось незамінне зникло. Подих смерті.",
        },
        {
          title: "Темна ніч душі",
          synopsis:
            "Протагоніст сидить серед руїн. Дайте темі, посіяній у побічній лінії, виринути й бути зрозумілою.",
        },
        {
          title: "Вхід у третю дію",
          synopsis:
            "Прозріння, що робить новий план можливим: головна й побічна лінії сходяться, і протагоніст обирає знову.",
        },
        {
          title: "Фінал",
          synopsis:
            "План у дії, щаблями вгору: зібрати команду, взяти фортецю, зустріти найгірше і перемогти ціною.",
        },
        {
          title: "Фінальний образ",
          synopsis:
            "Дзеркало початкового образу, що показує зміни — доказ, що історія щось означала.",
        },
      ],
    },
  },

  "story-circle": {
    en: {
      name: "Story circle",
      summary: "Eight scenes: Dan Harmon's circle — a character goes, gets, and pays.",
      beats: [
        {
          title: "You — comfort zone",
          synopsis:
            "A character in their zone of comfort. Establish what they have and what they are missing.",
        },
        {
          title: "Need",
          synopsis:
            "They want something. The want is stated plainly enough that the audience can measure it later.",
        },
        {
          title: "Go — unfamiliar situation",
          synopsis:
            "They enter an unfamiliar situation, by choice or by force, and the rules change under their feet.",
        },
        {
          title: "Search — adapt",
          synopsis:
            "They adapt, try, fail and try differently. This is the longest stretch: the price of the want is being paid.",
        },
        {
          title: "Find — get what they wanted",
          synopsis:
            "They find what they came for. Give it to them fully, so the cost of keeping it can be felt.",
        },
        {
          title: "Take — pay a heavy price",
          synopsis:
            "Getting it costs more than they expected. Something else — a relationship, a belief, safety — is spent.",
        },
        {
          title: "Return — back to the familiar",
          synopsis:
            "They come back to where they started, changed, and the familiar place is no longer a fit.",
        },
        {
          title: "Change",
          synopsis:
            "They have changed, for better or worse. Show it in an action, not a statement — the circle closes and opens.",
        },
      ],
    },
    uk: {
      name: "Коло історії",
      summary: "Вісім сцен: коло Дена Гармона — персонаж іде, здобуває і платить.",
      beats: [
        {
          title: "Ти — зона комфорту",
          synopsis: "Персонаж у своїй зоні комфорту. Покажіть, що він має і чого йому бракує.",
        },
        {
          title: "Потреба",
          synopsis:
            "Він чогось хоче. Це бажання сформульовано досить ясно, щоб згодом його можна було виміряти.",
        },
        {
          title: "Іди — незнайома ситуація",
          synopsis:
            "Він входить у незнайому ситуацію — з власної волі чи з примусу, — і правила змінюються під ногами.",
        },
        {
          title: "Шукай — адаптація",
          synopsis:
            "Він адаптується, пробує, зазнає невдачі й пробує інакше. Це найдовша частина: ціна бажання вже сплачується.",
        },
        {
          title: "Знайди — отримання бажаного",
          synopsis:
            "Він знаходить те, по що йшов. Дайте йому це повністю, щоб відчулася ціна утримання.",
        },
        {
          title: "Візьми — важка ціна",
          synopsis:
            "Отримання коштує більше, ніж він чекав. Витрачено щось інше — стосунки, віру, безпеку.",
        },
        {
          title: "Повернись — назад до звичного",
          synopsis: "Він повертається туди, звідки почав, зміненим, і звичне місце вже не пасує.",
        },
        {
          title: "Зміна",
          synopsis:
            "Він змінився — на краще чи на гірше. Покажіть це дією, а не словами: коло замикається і відкривається.",
        },
      ],
    },
  },
};

/**
 * The template as text for `createScenesFromList`: one `Title | Synopsis` line per beat.
 * The parser splits on `|`, so neither a title nor a synopsis may contain one.
 */
export function templateSceneText(id: TemplateId, locale: "en" | "uk"): string {
  return TEMPLATE_CONTENT[id][locale].beats
    .map((beat) => `${beat.title} | ${beat.synopsis}`)
    .join("\n");
}
