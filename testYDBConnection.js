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
} = require("ydb-sdk");

require("dotenv").config();

const endpoint = process.env.YDB_ENDPOINT;
const database = process.env.YDB_DATABASE;

const saCredentials = getSACredentialsFromJson("authorized_key.json");
const authService = new IamAuthService(saCredentials); // getCredentialsFromEnv

const TABLE_NAME = "my_first_table";

const driver = new Driver({ endpoint, database, authService });

//async function createTable(session) {
//  const columns = [
//    new Column("id", Types.UINT64), // Тип Uint64
//    new Column("name", Types.UTF8), // Тип Utf8
//  ];
//
//  const primaryKeys = ["id"];
//
//  const tableDescription = new TableDescription(columns, primaryKeys);
//
//  console.log(`Создание таблицы '${TABLE_NAME}'...`);
//
//
//  await session.createTable(TABLE_NAME, tableDescription);
//
//  console.log(`Таблица '${TABLE_NAME}' успешно создана.`);
//}

async function createTable(driver) {
    await driver.queryClient.do({
        fn: async (session) => {

          try{
            await session.execute({
                text: `
                    CREATE TABLE ${"Testtable"}
                    (
                        series_id    BigSerial NOT NULL,
                        title        Utf8,
                        series_info  Utf8,
                        release_date DATE,
                        PRIMARY KEY (series_id)
                    );
                   `,
            });
          } catch{
            
          }
        },
    });
}

async function insertData(session) {
    const insertQuery = `
        DECLARE $id AS Uint64;
        DECLARE $name AS Utf8;
        
        REPLACE INTO ${TABLE_NAME} (id, name) VALUES ($id, $name);
    `;

    const records = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' }
    ];

    console.log(`Вставка ${records.length} записей в таблицу '${TABLE_NAME}'...`);
    
    console.log('Подготовка запроса...');
    const preparedQuery = await session.prepareQuery(insertQuery);
    

    const txMeta = await session.beginTransaction({serializableReadWrite: {}});
    const txId = txMeta.id;
    
    const txControl = { txId };

    try {
        for (const record of records) {
            const params = {
                '$id': TypedValues.uint64(record.id),
                '$name': TypedValues.utf8(record.name),
            };

            await session.executeQuery(preparedQuery, params, txControl);
        }

        await session.commitTransaction({txId});
        console.log(`Транзакция с ID ${txId} успешно зафиксирована.`);

    } catch (error) {
        console.error(`Ошибка при выполнении транзакции, откат: ${error}`);
        await session.rollbackTransaction({txId});
        throw error;
    }

    console.log("Данные успешно вставлены.");
}


async function insertSimpleData(session, record) {
    const { user_id, name } = record;
    
    // 1. Формируем дату в формате YQL (Unix Timestamp) или ISO-строкой
    // Здесь мы используем CurrentUtcDatetime() на стороне базы данных для простоты.
    // Если вам нужно передавать дату, используйте Types.DATETIME и TypedValues.datetime.
    
    // Экранирование строк, чтобы избежать SQL-инъекций и ошибок синтаксиса
    const esc = (str) => `'${str.replace(/'/g, "''")}'`;


    await session.executeQuery(`
        INSERT INTO ${TABLE_NAME} (id, name)
        VALUES (
            ${user_id},
            ${esc(name)}
        );
    `);
    
}

async function run() {
  if (!(await driver.ready(10000))) {
    process.exit(1);
  }

  try {
    await createTable(driver);
    await driver.tableClient.withSession(async (session) => {

    await session.executeQuery(`
        INSERT INTO Testtable (title, series_info)
        VALUES (
            title,
            info
        );
    `);

      //await createTable(session);
      // await insertData(session);
      //await insertSimpleData(session, {user_id: 7, name: "loh"});
    });
  } catch (err) {
    console.log(err);
  }

  await driver.destroy();
}

run();
