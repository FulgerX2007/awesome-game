'use strict';
// Adâncul (Глубина) — Romanian dictionary. Keys are the Russian source strings.
I18n.add({
  ro: {
    // Page (the language switch names Russian in Russian)
    'Русский': 'Русский',
    'Глубина': 'Adâncul',
    'Спокойная игра про океан: начни клеткой, ешь тех, кто меньше, и вырасти от кита до морской легенды.':
      'Un joc liniștit despre ocean: începi ca o celulă, îi mănânci pe cei mai mici și crești de la balenă până la o legendă a mării.',
    'Океан': 'Ocean',

    // HUD
    'Клетка': 'Celulă',
    '10 мкм': '10 μm',
    'Путь до Левиафана': 'Drumul până la Leviatan',
    'Дальше: {stage} · {pct}%': 'Urmează: {stage} · {pct}%',
    'Рост до {len} · {pct}%': 'Creștere până la {len} · {pct}%',
    'длина {len}': 'lungime {len}',
    'рекорд: {len}': 'record: {len}',
    'Звук: вкл': 'Sunet: pornit',
    'Звук: выкл': 'Sunet: oprit',
    'Рывок': 'Țâșnire',
    'рывок': 'țâșnire',

    // Length units
    '{n} мкм': '{n} μm',
    '{n} мм': '{n} mm',
    '{n} см': '{n} cm',
    '{n} м': '{n} m',

    // Stages
    'Рачок': 'Racușor',
    'Малёк': 'Puiet',
    'Рыба': 'Pește',
    'Кальмар': 'Calmar',
    'Акула': 'Rechin',
    'Кит': 'Balenă',
    'Кракен': 'Kraken',
    'Левиафан': 'Leviatan',

    // Menu
    'Ты — крошечная клетка в толще океана. Ешь тех, кто меньше тебя, и расти: рачок, малёк, рыба, кальмар, акула, кит. А дальше — то, что встречается только в морских легендах.':
      'Ești o celulă minusculă în largul oceanului. Mănâncă-i pe cei mai mici decât tine și crește: racușor, puiet, pește, calmar, rechin, balenă. Iar mai departe, ce se întâlnește doar în legendele mării.',
    'Плыви за курсором или пальцем.': 'Înoată după cursor sau după deget.',
    'Пробел': 'Space',
    ', зажатая кнопка мыши или кнопка «рывок» — короткое ускорение.':
      ', butonul mouse-ului ținut apăsat sau butonul „țâșnire” îți dau un scurt avânt.',
    'Опасны только хищники крупнее тебя. Когда хищник тебя заметил, он светится':
      'Periculoși sunt doar prădătorii mai mari decât tine. Când un prădător te-a observat, strălucește în',
    'красным': 'roșu',
    '. Погоня его утомляет.': '. Urmărirea îl obosește.',
    'Если тебя съедят, ты потеряешь половину размера и поплывёшь дальше. Конца игры нет.':
      'Dacă te mănâncă cineva, pierzi jumătate din mărime și înoți mai departe. Jocul nu are sfârșit.',
    'Начать с клетки': 'Ia-o de la celulă',
    'Нырнуть': 'Scufundă-te',
    'Продолжить: {stage}, {len}': 'Continuă: {stage}, {len}',

    // Toasts
    'Ешь тех, кто меньше. Красное свечение — опасность.': 'Mănâncă-i pe cei mai mici. Lumina roșie înseamnă pericol.',
    'Появились лапки и усики. Теперь тебя видно в микроскоп.': 'Ți-au crescut piciorușe și antene. Acum te poți vedea la microscop.',
    'Плавник, хвост и глаза. Стайки мальков разбегаются от тебя.': 'Înotătoare, coadă și ochi. Bancurile de puiet fug din calea ta.',
    'Ты рыба. Здесь уже водятся хищники, держи ухо востро.': 'Ești pește. Pe aici sunt deja prădători, fii cu ochii-n patru.',
    'Щупальца ловят всё, что меньше. Ты быстрый и опасный.': 'Tentaculele prind tot ce e mai mic. Ești iute și de temut.',
    'Ты акула. Опасаться почти некого.': 'Ești rechin. Aproape nimeni nu-ți mai poate face rău.',
    'Ты стал китом. Но моряки рассказывают о тех, кто ещё больше.': 'Ai devenit balenă. Dar marinarii povestesc despre unii și mai mari.',
    'Ты стал легендой. Теперь о тебе рассказывают страшные истории.': 'Ai devenit o legendă. Acum se spun povești înfricoșătoare despre tine.',
    'Ты Левиафан, царь глубин. Океан снова спокоен, и он твой.': 'Ești Leviatanul, regele adâncurilor. Oceanul e din nou liniștit și e al tău.',

    'Ты потерял половину размера, но плывёшь дальше.': 'Ai pierdut jumătate din mărime, dar înoți mai departe.',

    // Depth and zones
    'глубина {m} м · {zone}': 'adâncime {m} m · {zone}',
    'глубина {m} м': 'adâncime {m} m',
    'Солнечная зона': 'Zona luminată',
    'Свет, тепло и больше всего жизни.': 'Lumină, căldură și cea mai multă viață.',
    'Сумеречная зона': 'Zona crepusculară',
    'Синий полумрак. Многие здесь светятся сами.': 'Semiîntuneric albastru. Mulți de aici strălucesc singuri.',
    'Полночная зона': 'Zona de miezul nopții',
    'Солнце сюда не доходит. Видно только тех, кто светится, и того, кто рядом.': 'Soarele nu ajunge aici. Îi vezi doar pe cei care strălucesc și pe cei de lângă tine.',
    'Бездна': 'Abisul',
    'Холод и давление в сотни атмосфер. Еда редкая, но сытная.': 'Frig și o presiune de sute de atmosfere. Hrana e rară, dar sățioasă.',
    'Глубоководный жёлоб': 'Groapa abisală',
    'Самое дно океана. Сюда добирались единицы.': 'Chiar fundul oceanului. Puțini au ajuns vreodată aici.',

    // Menu additions
    'Спокойная игра про океан: начни клеткой, ешь тех, кто меньше, вырасти до кита, а потом до морской легенды, и опустись на дно Марианской впадины.':
      'Un joc liniștit despre ocean: începi ca o celulă, îi mănânci pe cei mai mici, crești până la balenă, apoi până la o legendă a mării, și cobori pe fundul Gropii Marianelor.',
    'Океан уходит вниз на 11 километров. Чем глубже, тем темнее, но и еда там сытнее, а живут там удивительные существа.':
      'Oceanul coboară 11 kilometri. Cu cât mai adânc, cu atât mai întuneric, dar hrana e mai sățioasă, iar acolo trăiesc creaturi uimitoare.',
    'В темноте видно только то, что рядом, и тех, кто светится сам. Не плыви на одинокий огонёк.':
      'În întuneric vezi doar ce e aproape și pe cei care strălucesc singuri. Nu înota spre o luminiță singuratică.',
    'Каждый новый вид попадает в атлас, он сохраняется навсегда.': 'Fiecare specie nouă intră în atlas, care se păstrează pentru totdeauna.',

    // Atlas
    'Атлас': 'Atlas',
    'Легенда': 'Legendă',
    'Атлас {n}/{total}': 'Atlas {n}/{total}',
    'Закрыть': 'Închide',
    '{n} из {total}': '{n} din {total}',
    'Новый вид: {name}': 'Specie nouă: {name}',
    'Запись в атласе: {n} из {total}': 'Intrare în atlas: {n} din {total}',
    'встречено: {seen} · съедено: {eaten}': 'întâlnite: {seen} · mâncate: {eaten}',
    'Ещё не встречался.': 'Încă nu ai întâlnit-o.',
    'Тебя поймали: {name}': 'Te-a prins: {name}',

    // Species
    'Диатомея': 'Diatomee',
    'Одноклеточная водоросль в стеклянном панцире. Диатомеи дают около пятой части всего кислорода Земли.':
      'O algă unicelulară într-o carapace de sticlă. Diatomeele produc cam o cincime din tot oxigenul Pământului.',
    'Ночесветка': 'Noctiluca',
    'Из-за неё ночью светятся волны: клетка вспыхивает голубым, когда её тревожат.': 'Din cauza ei strălucesc valurile noaptea: celula se aprinde albastru când e deranjată.',
    'Морской снег': 'Zăpada marină',
    'Хлопья органики, которые медленно падают сверху. Для бездны это главная еда, путь на дно занимает недели.':
      'Fulgi de materie organică ce cad încet de sus. Pentru abis e hrana principală, iar drumul până la fund durează săptămâni.',
    'Морская инфузория': 'Ciliat marin',
    'Плавает тысячами ресничек. Некоторые морские инфузории глотают водоросли и оставляют себе их хлоропласты: те продолжают работать и кормят хозяина светом.':
      'Înoată cu mii de cili. Unii ciliați marini înghit alge și le păstrează cloroplastele: acestea continuă să lucreze și își hrănesc gazda cu lumină.',
    'Радиолярия': 'Radiolar',
    'Строит кружевной скелет из кремнезёма. Из таких скелетов сложены целые горные породы.': 'Își construiește un schelet dantelat din silice. Din astfel de schelete sunt făcute roci întregi.',
    'Фораминифера': 'Foraminifer',
    'Клетка в спиральной раковине из камер. Ракушки фораминифер есть в известняке пирамид.': 'O celulă într-o cochilie spiralată cu camere. Cochilii de foraminifere se găsesc în calcarul piramidelor.',
    'Ксенофиофора': 'Xenofiofor',
    'Одна клетка размером с ладонь. Живёт даже на дне Марианской впадины.': 'O singură celulă cât palma. Trăiește chiar și pe fundul Gropii Marianelor.',
    'Веслоногий рачок': 'Copepod',
    'Самое многочисленное животное на планете. Прыгает на сотни длин тела в секунду.': 'Cel mai numeros animal de pe planetă. Sare sute de lungimi ale corpului pe secundă.',
    'Антарктический криль': 'Krill antarctic',
    'Весь антарктический криль весит примерно столько же, сколько всё человечество. Им питаются киты.': 'Tot krillul antarctic cântărește cam cât întreaga omenire. Din el se hrănesc balenele.',
    'Глубоководная креветка': 'Crevete de adâncime',
    'Защищаясь, выплёвывает облако светящейся слизи прямо в морду хищнику.': 'Ca să se apere, scuipă un nor de mucus luminos drept în botul prădătorului.',
    'Бокоплав': 'Amfipod',
    'Падальщик бездны. Бокоплавы находят упавшую на дно рыбу за считанные часы.': 'Gunoierul abisului. Amfipodele găsesc un pește căzut pe fund în doar câteva ore.',
    'Анчоус': 'Hamsie',
    'Плавает огромными косяками: так хищнику труднее выбрать одну рыбку.': 'Înoată în bancuri uriașe: așa prădătorului îi e mai greu să aleagă un singur pește.',
    'Рыба-фонарь': 'Pește-felinar',
    'Каждую ночь поднимается к поверхности за едой, а днём уходит на глубину. Это самая большая миграция на Земле.':
      'În fiecare noapte urcă spre suprafață după hrană, iar ziua coboară în adânc. E cea mai mare migrație de pe Pământ.',
    'Рыба-топорик': 'Pește-topor',
    'Светится брюхом ровно так же, как свет сверху, поэтому снизу её не видно.': 'Burta îi strălucește exact ca lumina de sus, așa că de dedesubt nu se vede.',
    'Морской слизень': 'Pește-melc',
    'Рыба-рекордсмен: её снимали на глубине 8 336 метров.': 'Un pește recordman: a fost filmat la 8 336 de metri adâncime.',
    'Скумбрия': 'Macrou',
    'Не может остановиться: чтобы дышать, ей нужно всё время плыть.': 'Nu se poate opri: ca să respire, trebuie să înoate tot timpul.',
    'Медуза-аурелия': 'Meduza-lună',
    'У неё нет мозга, сердца и костей, а тело на 98% состоит из воды.': 'Nu are creier, inimă sau oase, iar corpul ei e 98% apă.',
    'Гребневик': 'Ctenofor',
    'Ряды крошечных гребней переливаются радугой. По последним данным, гребневики — одна из самых древних ветвей животных.':
      'Șiruri de pieptăni minusculi sclipesc în culorile curcubeului. După cele mai noi date, ctenoforele sunt una dintre cele mai vechi ramuri ale animalelor.',
    'Рыба-гадюка': 'Pește-viperă',
    'Зубы такие длинные, что не помещаются в пасти и торчат наружу.': 'Dinții îi sunt atât de lungi încât nu încap în gură și ies în afară.',
    'Удильщик': 'Pește-pescar',
    'Висит в темноте неподвижно и приманивает добычу светящейся «удочкой» на лбу. Не плыви на одинокий огонёк.':
      'Stă nemișcat în întuneric și își ademenește prada cu o „undiță” luminoasă pe frunte. Nu înota spre o luminiță singuratică.',
    'Рыба-тренога': 'Pește-trepied',
    'Стоит на дне на трёх длинных лучах плавников, как на ходулях, и ждёт, что принесёт течение.': 'Stă pe fund pe trei raze lungi de înotătoare, ca pe niște catalige, și așteaptă ce aduce curentul.',
    'Плавает реактивно: набирает воду в мантию и с силой выталкивает её.': 'Înoată cu reacție: trage apă în manta și o împinge afară cu putere.',
    'Адский вампир': 'Calmar-vampir',
    'Несмотря на имя, ест морской снег. При опасности выворачивается плащом наизнанку.': 'În ciuda numelui, mănâncă zăpadă marină. Când e în pericol, își întoarce mantia pe dos.',
    'Большерот': 'Țipar-pelican',
    'Пасть больше всего остального тела и раскрывается, как сачок, но ловит он ею в основном мелких рачков. Кончик хвоста светится.':
      'Gura e mai mare decât tot restul corpului și se deschide ca un minciog, dar prinde cu ea mai ales crustacee mărunte. Vârful cozii îi strălucește.',
    'Осьминог-дамбо': 'Caracatița-dumbo',
    'Машет плавниками, похожими на уши слонёнка. Живёт глубже всех осьминогов.': 'Dă din înotătoare ca din urechile unui pui de elefant. Trăiește mai adânc decât orice altă caracatiță.',
    'Синяя акула': 'Rechinul albastru',
    'Проплывает тысячи километров вслед за косяками рыб.': 'Înoată mii de kilometri pe urmele bancurilor de pești.',
    'Акула-домовой': 'Rechinul-spiriduș',
    'Выстреливает челюсти вперёд, чтобы схватить добычу. Розовая, потому что сквозь кожу видны сосуды.': 'Își aruncă fălcile înainte ca să prindă prada. E roz pentru că vasele de sânge se văd prin piele.',
    'Гигантский кальмар': 'Calmarul gigant',
    'Глаза размером с футбольный мяч, одни из самых больших в животном мире. Живым его впервые сфотографировали только в 2004 году.':
      'Ochi cât o minge de fotbal, printre cei mai mari din lumea animală. Viu a fost fotografiat abia în 2004.',
    'Горбатый кит': 'Balena cu cocoașă',
    'Самцы поют песни длиной до получаса, и вся популяция со временем меняет мелодию вместе.': 'Masculii cântă cântece de până la o jumătate de oră, iar toată populația își schimbă melodia împreună.',
    'Кашалот': 'Cașalot',
    'Ныряет на 2 км за гигантскими кальмарами и задерживает дыхание на час.': 'Se scufundă la 2 km după calmari giganți și își ține respirația o oră.',
    'Сифонофора': 'Sifonofor',
    'Колония из тысяч крошечных существ, вытянутая на 40 метров. Одно из самых длинных животных в мире.': 'O colonie din mii de vietăți mici, lungă de 40 de metri. Unul dintre cele mai lungi animale din lume.',

    // Legends
    'Морской змей': 'Șarpele de mare',
    'О нём рассказывали моряки всех морей. Часто за змея принимали сельдяного короля — настоящую рыбу длиной до 8 метров с красным гребнем.':
      'Despre el povesteau marinarii de pe toate mările. Adesea îl confundau cu peștele-vâslă, un pește adevărat de până la 8 metri, cu o creastă roșie.',
    'Чудовище из скандинавских легенд, которое утаскивает корабли на дно. Скорее всего, моряки видели гигантского кальмара.':
      'Monstrul din legendele scandinave care trage corăbiile la fund. Cel mai probabil, marinarii vedeau un calmar gigant.',
    'Аспидохелон': 'Aspidochelone',
    'Из средневековых бестиариев: черепаха такого размера, что моряки принимали её спину за остров, высаживались и разводили костёр.':
      'Din bestiarele medievale: o broască-țestoasă atât de mare încât marinarii îi luau spatele drept insulă, debarcau și făceau focul.',
    'Морское чудовище из Библии: «нет на земле подобного ему». В его честь назван ископаемый кашалот Livyatan, который охотился на китов 9 миллионов лет назад.':
      'Monstrul marin din Biblie: „nu este pe pământ asemenea lui”. După el a fost numit cașalotul fosil Livyatan, care vâna balene acum 9 milioane de ani.',
  },
});
