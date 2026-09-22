"""Loopback origin for Cloudflare Tunnel: localhost:15412 -> workspace model adapter."""
import httpx
from fastapi import FastAPI,Request
from fastapi.responses import StreamingResponse,JSONResponse

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)

@app.get('/')
def index():
    return {'service':'urJev structured decision API','base_url':'https://ai2.aischool.edu.pl/v1','endpoint':'/v1/systemone','method':'POST','model':'urjev','playground':'https://ai3.aischool.edu.pl/','authentication':'No Auth for /v1/systemone; existing Qwen routes require Bearer API key'}

@app.post('/v1/systemone')
async def urjev(request:Request):
    if not request.headers.get('content-type','').startswith('application/json'):
        return JSONResponse({'error':{'code':'CONTENT_TYPE','message':'Use application/json'}},status_code=415)
    body=bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body)>65536:
            return JSONResponse({'error':{'code':'BODY_TOO_LARGE','message':'Request limit is 64 KB'}},status_code=413)
    try:
        async with httpx.AsyncClient(timeout=125,trust_env=False) as client:
            response=await client.post('http://127.0.0.1:15413/v1/systemone',content=bytes(body),headers={'Content-Type':'application/json'})
    except httpx.TimeoutException:
        return JSONResponse({'error':{'code':'MODEL_TIMEOUT','message':'urJev timed out'}},status_code=504)
    except httpx.HTTPError:
        return JSONResponse({'error':{'code':'MODEL_OFFLINE','message':'urJev unavailable'}},status_code=503)
    from fastapi.responses import Response
    headers={'Cache-Control':'no-store'}
    if response.headers.get('server-timing'):headers['Server-Timing']=response.headers['server-timing']
    return Response(content=response.content,status_code=response.status_code,media_type='application/json',headers=headers)

@app.api_route('/v1/{path:path}',methods=['GET','POST'])
async def proxy(path:str,request:Request):
    if not path.startswith('workspace/') and (request.method,path) not in {('GET','models'),('POST','chat/completions'),('POST','completions')}:
        return JSONResponse({'error':'Not found'},status_code=404)
    if not request.headers.get('authorization','').startswith('Bearer '):
        return JSONResponse({'error':'API key required'},status_code=401,headers={'WWW-Authenticate':'Bearer'})
    body=await request.body()
    if len(body)>4000000:return JSONResponse({'error':'Request too large'},status_code=413)
    client=httpx.AsyncClient(timeout=610,trust_env=False)
    try:
        response=await client.send(client.build_request(request.method,'http://127.0.0.1:15415/model/v1/'+path,content=body,headers={'Content-Type':'application/json','Authorization':request.headers['authorization'],**({'Idempotency-Key':request.headers['idempotency-key']} if 'idempotency-key' in request.headers else {})}),stream=True)
    except httpx.HTTPError:
        await client.aclose();return JSONResponse({'error':'Model adapter unavailable'},status_code=503)
    async def stream():
        try:
            async for chunk in response.aiter_bytes():yield chunk
        finally:await response.aclose();await client.aclose()
    headers={'Cache-Control':'no-store','X-Accel-Buffering':'no'}
    if response.headers.get('retry-after'):headers['Retry-After']=response.headers['retry-after']
    return StreamingResponse(stream(),status_code=response.status_code,media_type=response.headers.get('content-type','application/json'),headers=headers)
