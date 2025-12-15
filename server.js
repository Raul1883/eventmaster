const express = require("express");
const cors = require("cors");
const session = require("express-session");
const path = require("path");

const {
  initYDB,
  closeYDB,
  asyncCreateNotification,
  asyncDeleteNotification,
  asyncReadNotification,
  asyncGetAllNotificationsByID,
  asyncCreateUser,
  asyncGetUserByLoginOrEmailAndPswd,
  asyncGetUserDataById,
  asyncGetUserDataByLogin,
  asyncGetAllUsers,
  asyncUpdateUser,
  asyncCreateEvent,
  asyncGetAllEvents,
  asyncGetUserEventsById,
  asyncJoinOrLeaveEvent,
} = require("./db-func");

require("dotenv").config();

async function startServer() {
  try {
    // ИНИТ БД
    await initYDB();

    // настрйока сервера

    const app = express();

    // Configure CORS to allow multiple origins
    const allowedOrigins = ["http://localhost:3000", "http://127.0.0.1:5500"];
    app.use(
      cors({
        origin: function (origin, callback) {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error("Not allowed by CORS"));
          }
        },
        credentials: true,
      })
    );
    app.use(express.json());

    // Configure session middleware
    app.use(
      session({
        // может быть добавлю хранение сессий через реддис. если доживу
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: false,
          httpOnly: true,
          maxAge: 24 * 60 * 60 * 1000,
        },
      })
    );

    // Middleware to check if user is authenticated ВАЖНО ПОТОМ ПЕРЕДЕЛАТЬ!

    function isAuthenticated(req, res, next) {
      return next(); // УБРАТЬ ПОТОМ ЭТО!!!!!
      if (req.session.userId) {
        return next();
      }
      res.status(401).json({ error: "Не авторизован" });
    }

    // DONE API для регистрации пользователя
    app.post("/api/register", async (req, res) => {
      const { login, password, email, name, secondname } = req.body;

      try {
        user_id = await asyncCreateUser(
          login,
          password,
          email,
          name,
          secondname
        );
        req.session.userId = user_id;
        req.session.login = login;
        res.json({ success: true, userId: user_id });
      } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Ошибка при проверке пользователя" });
      }
    });

    // DONE API для входа пользователя
    app.post("/api/login", async (req, res) => {
      const { loginOrEmail, password } = req.body;

      try {
        const row = await asyncGetUserByLoginOrEmailAndPswd(
          loginOrEmail,
          password
        );

        req.session.userId = row.id;
        req.session.login = row.login;
        res.json({ success: true, userId: row.id, login: row.login });
      } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Ошибка при проверке пользователя" });
      }
    });

    // WITHOUT CHANGES API для выхода пользователя
    app.post("/api/logout", async (req, res) => {
      req.session.destroy((err) => {
        if (err) {
          res.status(500).json({ error: "Ошибка при выходе" });
        } else {
          res.json({ success: true });
        }
      });
    });

    // WITHOUT CHANGES API для проверки сессии
    app.get("/api/check-session", (req, res) => {
      if (req.session.userId) {
        res.json({
          success: true,
          userId: req.session.userId,
          login: req.session.login,
        });
      } else {
        res.status(401).json({ error: "Сессия не найдена" });
      }
    });

    // DONE API для получения данных пользователя
    app.get("/api/user/:id", isAuthenticated, async (req, res) => {
      const userId = req.params.id;
      if (parseInt(userId) !== req.session.userId) {
        return res.status(403).json({ error: "Доступ запрещен" });
      }

      try {
        const user = await asyncGetUserDataById(userId);

        res.json({
          success: true,
          user: user,
        });
      } catch (err) {
        console.error(err.message);
        res
          .status(500)
          .json({ error: "Ошибка при получении данных пользователя" });
      }
    });

    // DONE API для проверки существования пользователя по логину
    app.get(
      "/api/check-user-login/:login",
      isAuthenticated,
      async (req, res) => {
        const login = req.params.login;

        try {
          const user = await asyncGetUserDataByLogin(login);

          res.json({
            success: true,
            user: user,
          });
        } catch (err) {
          console.error(err.message);
          res.status(500).json({ error: "Ошибка при проверке логина" });
        }
      }
    );

    // DONE API для обновления профиля пользователя
    app.put("/api/user/:id", isAuthenticated, async (req, res) => {
      const userId = req.params.id;

      if (parseInt(userId) !== req.session.userId) {
        return res.status(403).json({ error: "Доступ запрещен" });
      }

      const { name, secondname, email } = req.body;

      try {
        await asyncUpdateUser(userId, {
          name: name,
          secondname: secondname,
          email: email,
        });
        res.json({ success: true });
      } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Ошибка при обновлении профиля" });
      }
    });

    // DONE New API to get all users
    app.get("/api/all-users", isAuthenticated, async (req, res) => {
      try {
        const users = await asyncGetAllUsers();

        res.json({ success: true, users: users });
      } catch (err) {
        console.error(err.message);
        res
          .status(500)
          .json({ error: "Ошибка при получении списка пользователей" });
      }
    });

    // API for joining or leaving an event
    app.post("/api/events/:id/:action", isAuthenticated, async (req, res) => {
      const eventId = req.params.id;
      const action = req.params.action;
      const login = req.session.login;
      console.log(
        `Received request: eventId=${eventId}, action=${action}, login=${login}`
      );

      if (action !== "join" && action !== "leave") {
        return res.status(400).json({ error: "Недопустимое действие" });
      }

      try {
        const { creatorId, title, newParticipant } =
          await asyncJoinOrLeaveEvent(eventId, action, login);
        // Асинхронно уведомляем создателя (вне основной транзакции)
        const message = `${login} ${
          action === "join" ? "присоединился к" : "отказался от участия в"
        } вашему мероприятию "${title}"`;

        await asyncCreateNotification(
          creatorId,
          message,
          "response",
          eventId
        ).catch((e) => {
          console.error("Ошибка при отправке уведомления создателю:", e);
        });

        res.json({ success: true, participants: newParticipant });
      } catch (error) {
        console.error("Критическая ошибка:", error.message);
        res.status(500).json({ error: "Ошибка сервера" });
      }
    });

    // DONE API для создания мероприятия
    // переделать
    app.post("/api/events", isAuthenticated, async (req, res) => {
      const {
        title,
        description,
        date,
        time,
        creator,
        participants,
        route_data,
        distance,
      } = req.body;
      const user_id = req.session.userId;

      if (!user_id || !title || !date) {
        console.log(user_id, title, date);
        return res
          .status(400)
          .json({ success: false, error: "Отсутствуют обязательные поля" });
      }

      try {
        const eventId = await asyncCreateEvent(
          user_id,
          title,
          description,
          date,
          time,
          creator,
          participants,
          route_data,
          distance
        );
        res.json({ success: true, eventId });
      } catch (err) {
        console.error(err.message);
        res.status(500).json({
          success: false,
          error: "Ошибка сервера при создании мероприятия",
        });
      }
    });

    // API для обновления мероприятия
    app.put("/api/events/:id", isAuthenticated, (req, res) => {
      const eventId = req.params.id;
      const user_id = req.session.userId;
      const {
        title,
        description,
        date,
        time,
        creator,
        participants,
        route_data,
        distance,
      } = req.body;

      console.log(
        `Received participants in request: ${JSON.stringify(participants)}`
      );

      db.get(
        `SELECT id, user_id, participants FROM Events WHERE id = ? AND user_id = ?`,
        [eventId, user_id],
        (err, row) => {
          if (err) {
            console.error("Ошибка при проверке мероприятия:", err.message);
            res.status(500).json({ error: "Ошибка при проверке мероприятия" });
            return;
          }
          if (!row) {
            console.warn(
              `Попытка редактирования мероприятия ${eventId} пользователем ${user_id}, не являющимся создателем`
            );
            res.status(403).json({
              error: "Только создатель мероприятия может его редактировать",
            });
            return;
          }

          let currentParticipants = [];
          try {
            currentParticipants = row.participants
              ? JSON.parse(row.participants)
              : [];
            if (!Array.isArray(currentParticipants)) {
              currentParticipants = [];
            }
          } catch (e) {
            console.error(
              `Ошибка парсинга currentParticipants для события ${eventId}:`,
              e.message
            );
            currentParticipants = [];
          }
          console.log(
            `Current participants from database: ${JSON.stringify(
              currentParticipants
            )}`
          );

          const newParticipantsArray = Array.isArray(participants)
            ? participants.filter(
                (p) => p && typeof p === "string" && p !== creator
              )
            : [];
          const newParticipantsJson = JSON.stringify([]); // Always initialize with empty participants for update
          const routeDataJson = route_data ? JSON.stringify(route_data) : null;

          const addedParticipants = newParticipantsArray.filter(
            (p) => !currentParticipants.includes(p)
          );
          console.log(
            `Added participants: ${JSON.stringify(addedParticipants)}`
          );

          const stmt = db.prepare(`
            UPDATE Events
            SET title = ?, description = ?, date = ?, time = ?, creator = ?,
                participants = ?, route_data = ?, distance = ?
            WHERE id = ?
        `);
          stmt.run(
            title,
            description || null,
            date,
            time || null,
            creator,
            newParticipantsJson,
            routeDataJson,
            distance || null,
            eventId,
            function (err) {
              if (err) {
                console.error(
                  "Ошибка при обновлении мероприятия:",
                  err.message
                );
                res
                  .status(500)
                  .json({ error: "Ошибка при обновлении мероприятия" });
              } else {
                if (addedParticipants.length > 0) {
                  const notificationPromises = addedParticipants.map(
                    (login) => {
                      return new Promise((resolve, reject) => {
                        console.log(
                          `Processing notification for login: ${login}`
                        );
                        db.get(
                          "SELECT id FROM Users WHERE login = ?",
                          [login],
                          (err, user) => {
                            if (err) {
                              console.error(
                                `Database error looking up user ${login}:`,
                                err
                              );
                              return reject(
                                new Error(
                                  `Database error for user ${login}: ${err.message}`
                                )
                              );
                            }
                            if (!user) {
                              console.warn(
                                `User ${login} not found in database, skipping notification.`
                              );
                              return resolve();
                            }

                            const message = `Вы были приглашены на мероприятие "${title}", запланированное на ${date}${
                              time ? " в " + time : ""
                            }.`;

                            createNotification(
                              user.id,
                              message,
                              "invitation",
                              eventId,
                              (err) => {
                                if (err) {
                                  console.error(
                                    `Failed to create notification for user ${login}:`,
                                    err
                                  );
                                  return reject(
                                    new Error(
                                      `Notification creation failed for ${login}: ${err.message}`
                                    )
                                  );
                                }
                                resolve();
                              }
                            );
                          }
                        );
                      });
                    }
                  );

                  Promise.allSettled(notificationPromises)
                    .then((results) => {
                      const successful = results.filter(
                        (result) => result.status === "fulfilled"
                      ).length;
                      const failed = results.filter(
                        (result) => result.status === "rejected"
                      ).length;
                      const errors = results
                        .filter((result) => result.status === "rejected")
                        .map((result) => result.reason.message);

                      if (errors.length > 0) {
                        console.error("Notification errors:", errors);
                      }
                      console.log(
                        `Notification results: ${successful} successful, ${failed} failed`
                      );
                    })
                    .catch((err) => {
                      console.error(
                        "Unexpected error in notification processing:",
                        err
                      );
                    });
                } else {
                  console.log(
                    "No new participants added, skipping notification creation."
                  );
                }
                res.json({ success: true });
              }
            }
          );
          stmt.finalize();
        }
      );
    });

    // API для удаления мероприятия
    app.delete("/api/events/:id", isAuthenticated, (req, res) => {
      const eventId = req.params.id;
      const userId = req.session.userId;

      db.get(
        `SELECT id, user_id FROM Events WHERE id = ? AND user_id = ?`,
        [eventId, userId],
        (err, row) => {
          if (err) {
            console.error("Ошибка при проверке мероприятия:", err.message);
            res.status(500).json({ error: "Ошибка при проверке мероприятия" });
            return;
          }
          if (!row) {
            console.warn(
              `Попытка удаления мероприятия ${eventId} пользователем ${userId}, не являющимся создателем`
            );
            res.status(403).json({
              error: "Только создатель мероприятия может его удалить",
            });
            return;
          }

          const stmt = db.prepare(`DELETE FROM Events WHERE id = ?`);
          stmt.run(eventId, function (err) {
            if (err) {
              console.error("Ошибка при удалении мероприятия:", err.message);
              res
                .status(500)
                .json({ error: "Ошибка при удалении мероприятия" });
            } else {
              // Delete related notifications
              db.run(
                `DELETE FROM Notifications WHERE event_id = ?`,
                [eventId],
                (err) => {
                  if (err) {
                    console.error(
                      "Ошибка при удалении уведомлений мероприятия:",
                      err.message
                    );
                  }
                }
              );
              res.json({ success: true });
            }
          });
          stmt.finalize();
        }
      );
    });

    // DONE API для получения всех мероприятий пользователя
    app.get("/api/events/:user_id", isAuthenticated, async (req, res) => {
      const userId = req.params.user_id;

      if (parseInt(userId) !== req.session.userId) {
        return res.status(403).json({ error: "Доступ запрещен" });
      }

      try {
        const events = await asyncGetUserEventsById(userId);
        res.json({ success: true, events });
      } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Ошибка при получении мероприятий" });
      }
    });

    // DONE API для получения всех мероприятий
    app.get("/api/all-events", async (req, res) => {
      try {
        const events = await asyncGetAllEvents();
        res.json({ success: true, events });
      } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: "Ошибка при получении мероприятий" });
      }
    });

    //// УВЕДМОЛЕНИЯ УВЕДОМЛЕНИЯ УВЕДОМЛЕНИЯ
    // Wrapper for notification creation to log all notifications
    // DONE
    // потом убрать
    function createNotification(userId, message, type, eventId, callback) {
      throw new Error("use depricated func createNotification");
      const createdAt = new Date().toISOString();
      console.log(
        `Attempting to create notification: user_id=${userId}, message="${message}", type=${type}, event_id=${eventId}, created_at=${createdAt}`
      );
      db.get(
        "SELECT id FROM Notifications WHERE user_id = ? AND event_id = ? AND type = ?",
        [userId, eventId, type],
        (err, existing) => {
          if (err) {
            console.error(
              `Database error checking existing notification:`,
              err
            );
            return callback(err);
          }
          if (existing) {
            console.log(
              `Notification already exists for user ${userId} and event ${eventId}, skipping creation`
            );
            return callback(null, existing.id);
          }
          db.run(
            "INSERT INTO Notifications (user_id, message, type, event_id, is_read, created_at) VALUES (?, ?, ?, ?, 0, ?)",
            [userId, message, type, eventId, createdAt],
            function (err) {
              if (err) {
                console.error(`Failed to create notification:`, err);
                callback(err);
              } else {
                const notificationId = this.lastID;
                console.log(`Notification created with ID: ${notificationId}`);
                db.get(
                  "SELECT * FROM Notifications WHERE id = ?",
                  [notificationId],
                  (err, row) => {
                    if (err) {
                      console.error(
                        `Error verifying notification ${notificationId}:`,
                        err
                      );
                    } else if (row) {
                      console.log(`Verified notification:`, row);
                    } else {
                      console.error(
                        `Notification ${notificationId} not found after insertion`
                      );
                    }
                    callback(null, notificationId);
                  }
                );
              }
            }
          );
        }
      );
    }

    // API для получения уведомлений пользователя
    // ГОТОВО (ВОПРОС С СЕССИЯМИ)
    app.get("/api/notifications", isAuthenticated, async (req, res) => {
      const userId = req.session.userId;

      if (!userId) {
        res.status(403).json({ error: "Сессия истекла" });
      }

      try {
        const notif_list = await asyncGetAllNotificationsByID(userId);
        res.json({ success: true, notifications: notif_list });
      } catch (err) {
        console.error("Ошибка при получении уведомлений:", err.message);
        res.status(500).json({ error: "Ошибка при получении уведомлений" });
      }
    });

    // API для создания уведомления
    // ГОТОВО
    app.post("/api/notifications", isAuthenticated, async (req, res) => {
      const { user_id, message, type = "reminder", event_id } = req.body;

      try {
        const notificationId = await asyncCreateNotification(
          user_id,
          message,
          type,
          event_id
        );
        res.json({ success: true, notificationId });
      } catch (err) {
        console.error("Ошибка при создании уведомления:", err.message);
        res.status(500).json({ error: "Ошибка при создании уведомления" });
      }
    });

    // API для удаления уведомления
    // ГОТОВО (ВОПРОС С СЕССИЯМИ)
    app.delete("/api/notifications/:id", isAuthenticated, async (req, res) => {
      const notificationId = req.params.id;
      const userId = req.session.userId;

      if (!userId) {
        res.status(403).json({ error: "Сессия истекла" });
      }

      try {
        await asyncDeleteNotification(notificationId, userId);
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: "Ошибка при удалении уведомления" });
      }
    });

    // API для пометки уведомления как прочитанного
    // ГОТОВО (ВОПРОС С СЕССИЯМИ)
    app.put(
      "/api/notifications/:id/read",
      isAuthenticated,
      async (req, res) => {
        const notificationId = req.params.id;
        const userId = req.session.userId;

        if (!userId) {
          res.status(403).json({ error: "Сессия истекла" });
        }

        try {
          await asyncReadNotification(notificationId, userId);
          res.json({ success: true });
        } catch {
          res.status(500).json({ error: "Ошибка при проверке уведомления" });
        }
      }
    );

    // Static files
    app.use(express.static(__dirname));

    // Handle non-existing routes
    app.use((req, res) => {
      res.status(404).json({ error: "Маршрут не найден" });
    });

    // ИНИТ СЕРВЕР

    const PORT = 3000;
    const server = app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
      console.log("Завершение работы сервера...");

      (async () => {
        try {
          await closeYDB();
          server.close(() => {
            console.log("Сервер остановлен");
            process.exit(0);
          });
        } catch (error) {
          console.error("Ошибка при корректном завершении работы:", error);
          server.close(() => {
            process.exit(1);
          });
        }
      })();
    });
  } catch (error) {
    console.error("КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА ПРИЛОЖЕНИЯ:", error);
    process.exit(1);
  }
}

startServer();
