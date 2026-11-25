# ФОП Поруч (MVP)
npm install && npm run dev  → http://localhost:3000 (API: NEXT_PUBLIC_API_URL, за замовчуванням http://localhost:8000)

## Очікувані ендпоінти FastAPI
POST /auth/register {full_name,email,password,role,profession}
POST /auth/login {email,password} → {access_token, role, full_name}
GET  /specialists → [{id,full_name,profession,bio,services:[{id,title,price}],slots:[ISO]}]
POST /appointments {specialist_id,service_id,slot} → {id};  POST /appointments/{id}/pay
GET  /appointments/my → [{id,service_title,slot,status:"pending"|"paid",peer_id,peer_name}]
POST /ai/ask {question} → {summary,steps:[],source:{title,url}}
GET  /messages/{peer_id} → [{id,from_id,text}];  POST /messages {to_id,text}
GET  /services/my;  POST /services {title,price}
CORS: дозвольте http://localhost:3000 через CORSMiddleware.
