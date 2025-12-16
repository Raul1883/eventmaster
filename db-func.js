const { json } = require("express");
const {
  Driver,
  getCredentialsFromEnv,
  getSACredentialsFromJson,
  IamAuthService,
  TableSession,
  TableDescription,
  Column,
  Types,
  TypedValues,
  Ydb,
  RowType,
  typeMetadataKey,
} = require("ydb-sdk");
const { DropTableSettings } = require("ydb-sdk");

require("dotenv").config();

const endpoint = process.env.YDB_ENDPOINT;
const database = process.env.YDB_DATABASE;

// const saCredentials = getSACredentialsFromJson("authorized_key.json"); // для ручного запуска
const saCredentials = getCredentialsFromEnv(); // для запуска внутри облака
const authService = new IamAuthService(saCredentials);

const driver = new Driver({ endpoint, database, authService });

// имена таблиц
const NOTIFICATION_TABLE_NAME = "Notifications";
const USERS_TABLE_NAME = "Users";
const EVENTS_TABLE_NAME = "Events";

// utils

async function resultSetToList(res) {
  let foundRows = [];

  for await (const resultSet of res.resultSets) {
    for await (const row of resultSet.rows) {
      foundRows.push(row);
    }
  }
  return foundRows;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
// ПОЛЬЗОВАТЕЛИ /////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////

async function asyncCreateUser(login, password, email, name, secondname) {
  // проверка существования
  // `SELECT * FROM Users WHERE login = ? OR email = ?`,

  async function getUserByUniqueFilds(login, email) {
    const res = await driver.queryClient.do({
      fn: async (session) => {
        const res = await session.execute({
          parameters: {
            $login: TypedValues.utf8(login),
            $email: TypedValues.utf8(email),
          },
          text: `
        SELECT * FROM ${USERS_TABLE_NAME}     
        WHERE login = $login OR email = $email;`,
        });

        return await resultSetToList(res);
      },
    });
    if (res.length == 0) return null;
    return res[0];
  }

  const existingUsers = await getUserByUniqueFilds(login, email);

  if (existingUsers) {
    throw new Error("User с таким логином или почтой уже существует");
  }
  // вставка вбд
  // INSERT INTO Users (login, password, email, name, secondname)
  // VALUES (?, ?, ?, ?, ?)

  await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $login: TypedValues.utf8(login),
          $password: TypedValues.utf8(password),
          $email: TypedValues.utf8(email),
          $name: TypedValues.utf8(name),
          $secondname: TypedValues.utf8(secondname),
        },
        text: `
        INSERT INTO ${USERS_TABLE_NAME}    
        (login, password, email, name, secondname) 
        VALUES($login, $password, $email, $name, $secondname);`,
      });
    },
  });

  newUser = await getUserByUniqueFilds(login, email);

  return newUser.id;
}

async function asyncGetUserByLoginOrEmailAndPswd(loginOrEmail, password) {
  // взять в бд
  // вернуть id и логин
  //  SELECT * FROM Users
  //WHERE (login = ? OR email = ?) AND password = ?

  const userList = await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $loginOrEmail: TypedValues.utf8(loginOrEmail),
          $password: TypedValues.utf8(password),
        },
        text: `
        SELECT * FROM ${USERS_TABLE_NAME}     
        WHERE (login = $loginOrEmail OR email = $loginOrEmail) AND password = $password;`,
      });
      return await resultSetToList(res);
    },
  });

  if (userList.length == 0) throw new Error("Нет такого пользователя");

  const user = userList[0];
  return { id: user.id, login: user.login };
}

async function asyncGetUserDataById(userId) {
  const userList = await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $id: TypedValues.int32(userId),
        },
        text: `
        SELECT * FROM ${USERS_TABLE_NAME}     
        WHERE id = $id;`,
      });
      return await resultSetToList(res);
    },
  });

  if (userList.length == 0) throw new Error("Нет такого пользователя по id");

  const user = userList[0];

  return {
    name: user.name,
    secondname: user.secondname,
    email: user.email,
    login: user.login,
  };
}

async function asyncGetUserDataByLogin(login) {
  const userList = await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $login: TypedValues.utf8(login),
        },
        text: `
        SELECT * FROM ${USERS_TABLE_NAME}     
        WHERE login = $login;`,
      });
      return await resultSetToList(res);
    },
  });

  if (userList.length == 0) throw new Error("Нет такого пользователя по id");
  const user = userList[0];

  return {
    id: user.id,
    name: user.name,
    secondname: user.secondname,
    login: user.login,
  };
}

async function asyncGetAllUsers() {
  return await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        text: `
        SELECT id, login, name, secondname FROM ${USERS_TABLE_NAME};`,
      });
      return await resultSetToList(res);
    },
  });
}

async function asyncUpdateUser(userId, user) {
  await driver.queryClient.do({
    fn: async (session) => {
      if (user.name) {
        await session.execute({
          parameters: {
            $userId: TypedValues.int32(userId),
            $value: TypedValues.utf8(user.name),
          },
          text: `UPDATE ${USERS_TABLE_NAME}
        SET name = $value
        WHERE id =$userId;`,
        });
      }

      if (user.secondname) {
        await session.execute({
          parameters: {
            $userId: TypedValues.int32(userId),
            $value: TypedValues.utf8(user.secondname),
          },
          text: `UPDATE ${USERS_TABLE_NAME}
        SET secondname = $value
        WHERE id =$userId;`,
        });
      }

      if (user.email) {
        const res = await session.execute({
          parameters: { $email: TypedValues.utf8(user.email) },
          text: `
        SELECT id FROM ${USERS_TABLE_NAME}
        WHERE email=$email;`,
        });

        userList = await resultSetToList(res);
        if (userList.length != 0) {
          if (userList[0].id != userId) {
            throw new Error("User с такой почтой уже есть");
          }
        }

        await session.execute({
          parameters: {
            $userId: TypedValues.int32(userId),
            $value: TypedValues.utf8(user.email),
          },
          text: `UPDATE ${USERS_TABLE_NAME}
        SET email = $value
        WHERE id =$userId;`,
        });
      }
    },
  });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
// События /////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////

async function asyncCreateEvent(
  user_id,
  title,
  description,
  date,
  time,
  creator,
  participants,
  route_data,
  distance
) {
  // создать event

  if (participants) {
    participants = participants.filter((item) => item !== creator);
  }

  const newEventId = await driver.queryClient.do({
    fn: async (session) => {
      const result = await session.execute({
        parameters: {
          $user_id: TypedValues.int32(user_id),
          $title: TypedValues.utf8(title),
          $description: TypedValues.fromNative(
            Types.optional(Types.UTF8),
            description
          ),
          $date: TypedValues.utf8(date),
          $time: TypedValues.fromNative(Types.optional(Types.UTF8), time),
          $creator: TypedValues.utf8(creator),
          $participants: TypedValues.fromNative(
            Types.optional(Types.JSON),
            JSON.stringify(participants)
          ),
          $route_data: TypedValues.fromNative(
            Types.optional(Types.JSON),
            JSON.stringify(route_data)
          ),
          $distance: TypedValues.fromNative(
            Types.optional(Types.DOUBLE),
            distance
          ),
        },
        text: `
        DECLARE $description AS Utf8?;
        DECLARE $time AS Utf8?;
        DECLARE $participants AS Json?;
        DECLARE $route_data AS Json?;
        DECLARE $distance AS Double?; 

        INSERT INTO ${EVENTS_TABLE_NAME}    
        (user_id, title, description, date, time, creator, participants, route_data, distance) 
        VALUES($user_id, $title, $description, $date, $time, $creator, 
        $participants, $route_data, $distance)
        RETURNING id;
        `,
      });

      const insertedId = (await resultSetToList(result))[0];

      return insertedId.id;
    },
  });

  if (participants && participants.length > 0) {
    // 1. Создание асинхронных задач для каждого участника
    // Каждая задача включает: поиск ID И создание уведомления.

    const notificationTasks = participants.map(async (login) => {
      // I. Асинхронно получаем ID пользователя
      const userData = await asyncGetUserDataByLogin(login);

      if (!userData || !userData.id) {
        console.warn(`Пользователь ${login} не найден. Пропуск уведомления.`);
        return null; // Пропускаем несуществующих
      }

      const message = `Вы были приглашены на мероприятие «${title}», запланированное на ${date}${
        time ? " в " + time : ""
      }.`;
      const type = "invitation";

      await asyncCreateNotification(userData.id, message, type, newEventId);

      return userData.id;
    });

    await Promise.allSettled(notificationTasks);
  }

  return newEventId;
}

async function asyncGetAllEvents() {
  const result_list = await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        text: `
        SELECT * FROM ${EVENTS_TABLE_NAME}
        ORDER BY date DESC;`,
      });
      return await resultSetToList(res);
    },
  });

  result_list.forEach((row) => {
    row.participants = row.participants ? JSON.parse(row.participants) : null;
    row.routeData = row.routeData ? JSON.parse(row.routeData) : null;
  });

  return result_list;
}

async function asyncGetUserEventsById(user_id) {
  const result_list = await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $user_id: TypedValues.int32(user_id),
        },
        text: `
        SELECT * FROM ${EVENTS_TABLE_NAME}
        WHERE user_id = $user_id
        ORDER BY date DESC;`,
      });
      return await resultSetToList(res);
    },
  });

  result_list.forEach((row) => {
    row.participants = row.participants ? JSON.parse(row.participants) : null;
    row.routeData = row.routeData ? JSON.parse(row.routeData) : null;
  });

  return result_list;
}

async function asyncJoinOrLeaveEvent(eventId, action, login) {
  const eventSet = await driver.queryClient.do({
    fn: async (session) => {
      // 1. SELECT (Чтение в начале транзакции)
      const eventSetSession = await session.execute({
        parameters: {
          $eventId: TypedValues.int32(eventId),
        },
        text: `
        SELECT * FROM ${EVENTS_TABLE_NAME}
        WHERE id = $eventId;`,
      });
      return eventSetSession;
    },
  });

  const event = (await resultSetToList(eventSet))[0];
  if (!event) throw new Error("Event not found");

  event.participants = event.participants
    ? JSON.parse(event.participants)
    : null;

  let newParticipantsList = null;
  if (action === "join") {
    if (event.participants.includes(login)) {
      throw new Error("Уже участник");
    } else {
      newParticipantsList = event.participants;
      newParticipantsList.push(login);
    }
  } else {
    if (event.participants.includes(login)) {
      newParticipantsList = event.participants.filter((item) => item !== login);
    } else {
      throw new Error("Не является участником");
    }
  }
  event.participants = JSON.stringify(newParticipantsList);

  const updatedEvent = await driver.queryClient.do({
    fn: async (session) => {
      const eventSetSession = await session.execute({
        parameters: {
          $eventId: TypedValues.int32(eventId),
          $participants: TypedValues.json(event.participants),
        },
        text: `
        UPDATE ${EVENTS_TABLE_NAME} 
        SET participants = $participants WHERE id = $eventId
        RETURNING *;`,
      });
      return (await resultSetToList(eventSetSession))[0];
    },
  });

  return {
    creatorId: updatedEvent.userId,
    title: updatedEvent.title,
    newParticipant: newParticipantsList,
  };
}

async function asyncDeleteEvent(eventId, userId) {
  const result_list = await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $id: TypedValues.int32(eventId),
          $user_id: TypedValues.int32(userId),
        },
        text: `
        SELECT * FROM ${EVENTS_TABLE_NAME}
        WHERE user_id = $user_id AND id = $id;`,
      });
      return (await resultSetToList(res))[0];
    },
  });

  if (!result_list)
    throw new Error("Только создатель мероприятия может его удалить");

  await driver.queryClient.do({
    fn: async (session) => {
      const res = await session.execute({
        parameters: {
          $id: TypedValues.int32(eventId),
        },
        text: `
        DELETE FROM ${EVENTS_TABLE_NAME}
        WHERE id = $id;`,
      });
    },
  });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
// УВЕДОМЛЕНИЯ /////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////

// не импортируется!
async function getNotificationByID(notificationId) {
  const res = await driver.queryClient.do({
    fn: async (session) => {
      let foundRows = [];
      const res = await session.execute({
        parameters: {
          $id: TypedValues.uint64(notificationId),
        },
        text: `
        SELECT id, user_id FROM ${NOTIFICATION_TABLE_NAME}     
        WHERE id = $id;`,
      });

      for await (const resultSet of res.resultSets) {
        for await (const row of resultSet.rows) {
          foundRows.push(row);
        }
      }
      return foundRows;
    },
  });

  if (res.length == 0) {
    return null;
  }
  return res[0];
}

async function asyncGetAllNotificationsByID(userID) {
  const res = await driver.queryClient.do({
    fn: async (session) => {
      let foundRows = [];
      const res = await session.execute({
        parameters: {
          $id: TypedValues.uint64(userID),
        },
        text: `
        SELECT * FROM ${NOTIFICATION_TABLE_NAME}     
        WHERE user_id = $id;`,
      });

      for await (const resultSet of res.resultSets) {
        for await (const row of resultSet.rows) {
          foundRows.push(row);
        }
      }
      return foundRows;
    },
  });

  return res;
}

async function asyncCreateNotification(userId, message, type, eventId) {
  async function getNotificationIdByUniqueKey(userId, type, eventId) {
    const res = await driver.queryClient.do({
      fn: async (session) => {
        let foundIds = [];
        const res = await session.execute({
          parameters: {
            $id: TypedValues.uint64(userId),
            $type: TypedValues.utf8(type),
            $eventId: TypedValues.uint64(eventId),
          },
          text: `
        SELECT id FROM ${NOTIFICATION_TABLE_NAME}     
        WHERE user_id = $id AND event_id = $eventId and type = $type;`,
        });

        for await (const resultSet of res.resultSets) {
          for await (const row of resultSet.rows) {
            foundIds.push(row.id);
          }
        }
        return foundIds;
      },
    });

    if (res.length == 0) {
      return null;
    }
    return res[0];
  }
  async function insertNotification(userId, message, type, eventId) {
    await driver.queryClient.do({
      fn: async (session) => {
        await session.execute({
          parameters: {
            $id: TypedValues.uint64(userId),
            $message: TypedValues.utf8(message),
            $type: TypedValues.utf8(type),
            $eventId: TypedValues.uint64(eventId),
            $isRead: TypedValues.uint64(0),
            $timestamp: TypedValues.utf8(new Date().toISOString()),
          },
          text: `
                    INSERT INTO ${NOTIFICATION_TABLE_NAME} (user_id, message, type, event_id, is_read, created_at)
                    VALUES ($id, $message, $type, $eventId, $isRead, $timestamp);`,
        });
      },
    });
  }

  const existingID = await getNotificationIdByUniqueKey(userId, type, eventId);

  if (existingID) {
    console.log(`Notification already exists, skipping. ID: ${existingID}`);
    return existingID; // Возвращаем ID существующего
  }

  await insertNotification(userId, message, type, eventId);

  const newNotificationId = await getNotificationIdByUniqueKey(
    userId,
    type,
    eventId
  );

  console.log(`Notification created with ID: ${newNotificationId}`);

  if (newNotificationId) {
    return newNotificationId;
  }

  throw new Error("Failed to retrieve ID after insertion.");
}

async function asyncDeleteNotification(notificationId, currentUserId) {
  const notification = await getNotificationByID(notificationId);

  if (!notification) {
    throw new Error(`Не сущетсвуте с id: ${notificationId} `);
  }

  if (notification.userId != currentUserId) {
    throw new Error(`Доступ запрещен`);
  }

  await driver.queryClient.do({
    fn: async (session) => {
      await session.execute({
        parameters: {
          $id: TypedValues.uint64(notificationId),
        },
        text: `
        DELETE FROM Notifications WHERE id = $id`,
      });
    },
  });

  return null;
}

async function asyncReadNotification(notification_id, user_id) {
  const notification = await getNotificationByID(notification_id);

  if (!notification) {
    throw new Error(`Не сущесвует с id: ${notification_id} `);
  }

  if (notification.userId != user_id) {
    throw new Error(`Доступ запрещен`);
  }

  await driver.queryClient.do({
    fn: async (session) => {
      await session.execute({
        parameters: {
          $id: TypedValues.uint64(notification_id),
        },
        text: `UPDATE Notifications SET is_read = 1 WHERE id = $id`,
      });
    },
  });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////
// СЛУЖЕБНОЕ////////////////////////////////////////////////////////////////////////////////////////////
////////////////////////////////////////////////////////////////////////////////////////////////////////

async function initYDB() {
  async function connectYDB() {
    if (!(await driver.ready(10000))) {
      console.error("Ошибка подключения к базе данных:");
      process.exit(1);
    }

    console.log("Подключено к YDB");
  }
  async function createTables(driver) {
    await driver.queryClient.do({
      fn: async (session) => {
        try {
          await session.execute({
            text: `
                    CREATE TABLE IF NOT EXISTS ${USERS_TABLE_NAME} (
                        id Serial,
                        login Utf8 NOT NULL,
                        password Utf8 NOT NULL,
                        email Utf8 NOT NULL,
                        name Utf8,
                        secondname Utf8,
                        PRIMARY KEY (id),
                    ); 
                                
                                
                    CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE_NAME} (
                        id Serial,
                        user_id Int32 NOT NULL,
                        title Utf8 NOT NULL,
                        description Utf8,
                        date Utf8 NOT NULL,
                        time Utf8,
                        creator Utf8 NOT NULL,
                        participants Json,
                        route_data Json,
                        distance Double,
                        PRIMARY KEY (id)
                    );
                                
                                
                    CREATE TABLE IF NOT EXISTS ${NOTIFICATION_TABLE_NAME} (
                        id Serial,
                        user_id Uint64 NOT NULL,
                        message Utf8 NOT NULL,
                        type Utf8 NOT NULL DEFAULT 'reminder',
                        event_id Uint64,
                        is_read Uint64 NOT NULL DEFAULT 0,
                        created_at Utf8 NOT NULL,
                        PRIMARY KEY (id)
                    );
                   `,
          });
          console.log("Таблицы созданы");
        } catch (err) {
          console.error("Ошибка при создании таблиц");
          console.error(err);
        }
      },
    });
  }

  await connectYDB();
  await createTables(driver);
}

async function closeYDB() {
  console.log("Закрытие соединения с YDB...");
  try {
    await driver.destroy();
    console.log("Соединение с YDB закрыто.");
  } catch (e) {
    console.error("Ошибка при закрытии YDB:", e.message);
  }
}

if (require.main === module) {
  console.log("test");
  async function testRun() {
    await initYDB();

    try {
      const res = await asyncDeleteEvent(2, 1);

      console.log(res);
    } catch (err) {
      console.log(err);
    }

    await closeYDB();
  }

  testRun();
}

module.exports = {
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
  asyncDeleteEvent,
};
