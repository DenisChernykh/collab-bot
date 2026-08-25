# Отложенные platform capabilities

- Статус: `Deferred — не блокирует первый запуск`
- Дата: `2026-08-25`
- Контекст: solo-разработка без бюджета, ручное распространение, ожидаются единицы или десятки пользователей без технического user cap.

## Правило

Первый запуск содержит только пользовательский цикл и минимальную защиту секретов, данных и контактов. Capability из этого документа не реализуется «на всякий случай». К ней возвращаются после указанного trigger или по отдельному решению автора проекта.

Отказ сейчас не означает, что решение плохое или запрещено навсегда. Это осознанная отсрочка стоимости до появления реальной потребности.

## Что отложено

| Capability | Что даёт | Почему не нужна сейчас | Когда вернуть | Потенциал переиспользования |
|---|---|---|---|---|
| `product_events` и funnel query | Формальная продуктовая воронка | Решение принимается по интересу и прямой обратной связи | Появились регулярные пользователи и конкретный вопрос, который нельзя решить вручную | Низкий: события и воронка продуктовые |
| Completion reports | Фиксирует, состоялось ли сотрудничество | Основной цикл заканчивается обменом контактами | Пользователи реально возвращаются и нужен follow-up | Низкий: workflow продукта |
| Durable completion reminder | Напоминает ответить о результате | Нет обязательного completion workflow | Completion reports уже используются | Средний: scheduler pattern общий, payload и policy продуктовые |
| Restore и block/unblock cascades | Расширенная модерация | Для малого запуска достаточно admin hide | Ручного hide недостаточно или появились повторные нарушения | Низкий: состояния и каскады продуктовые |
| Exact block/accept race policy | Детерминирует редкую конкурентную модерацию | Вероятность мала; не нужна без block workflow | Реализован block/unblock и воспроизведена гонка | Низкий: business policy продукта |
| Persisted heartbeat/status | Автоматически показывает состояние process | Автор может проверить process и logs вручную | Появился supervisor, удалённая эксплуатация или частые незаметные падения | Средний: каркас общий, health semantics bot-specific |
| Scheduled cleanup/retention | Удаляет старые технические записи | Малый объём SQLite не создаёт заметной проблемы | База измеримо растёт или появляется privacy/retention requirement | Средний: engine общий, retention policy bot-specific |
| Exact Unix-socket admission | Не допускает два process и обрабатывает stale socket | Один process запускается вручную | Появился auto-restart/supervisor или реальный double-start incident | Высокий как utility после стабилизации API |
| Automated backup/verify/restore | Снижает риск потери локальной SQLite | В начале допустим manual stop + file copy | Данные стали ценными, ручная процедура забывается или нужен заданный RPO | Высокий для SQLite-ботов, но paths/retention/restore policy настраиваются отдельно |
| LaunchAgent install/status tooling | Автоматически стартует и перезапускает bot на macOS | Ручного запуска достаточно для проверки интереса | Бот должен работать без ручного старта на постоянном Mac | Средний: generator общий, identity/paths/env всегда bot-specific |
| Многоцикловое deep review | Ищет редкие крайние случаи | Цена review превышает риск первого запуска | Изменение затрагивает ценные данные, credentials, payments или production recovery | Не код; повторяемый процесс |

## Что действительно можно переиспользовать между ботами

После появления второго реального consumer разумно выделять или аккуратно переносить:

- redacting JSON logger;
- Telegram error classification;
- fake Telegram transport/test harness;
- базовый SIGINT/SIGTERM shutdown helper;
- SQLite migration и integrity-check utilities;
- single-instance lock;
- configurable SQLite backup/verify primitives;
- delivery ledger/outbox engine, только если другому боту действительно нужна durable asynchronous delivery.

Нельзя считать универсальными и переносить без нового product review:

- типы `product_events` и формулы воронки;
- completion/reminder workflow;
- moderation states, cascades и race policy;
- конкретные retention сроки;
- health definition;
- LaunchAgent labels, paths, credentials и production identity.

Общий пакет не создаётся до второго подтверждённого consumer. До этого небольшое контролируемое дублирование дешевле поддержки внутренней платформы.

## Минимум, без которого запускать нельзя

Отложенный список не отменяет базовую безопасность. До передачи ссылки другим людям должны быть подтверждены:

- реальный bot token находится только во внешнем env и не попадает в Git или logs;
- запущен ровно один process;
- SQLite migrations и integrity checks проходят;
- повтор update/callback не дублирует business state;
- Bot API не вызывается внутри SQLite transaction;
- private contact доступен только принятой паре;
- admin может скрыть проблемную карточку;
- ошибки видны в безопасном логе;
- автор знает команду ручного запуска, остановки и расположение SQLite;
- перед рискованным обновлением process останавливается и SQLite копируется вручную.

При выполнении этого минимума запуск без остальных capabilities является нормальным и соразмерным риску solo-проекта.
