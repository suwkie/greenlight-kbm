import React from 'react'
import Ipc from '../lib/ipc'
import Image from 'next/image'

import Card from '../components/ui/card'
import Button from './ui/button'
import Loader from './ui/loader'

import { useTranslation } from 'react-i18next'

interface AuthProps {
  signedIn: boolean;
  gamertag?: string;
  gamerpic?: string;
  gamerscore?: string;
  isLoading?: boolean;
  userCode?: string;
  verificationUri?: string;
}

function Auth({
    signedIn = false,
    gamertag,
    gamerpic,
    gamerscore,
    isLoading = false,
    userCode = '',
    verificationUri = '',
}: AuthProps) {
    const { t } = useTranslation()

    function startAuthFlow(){
        Ipc.send('app', 'login')
    }

    function logout(){
        if(confirm(t('auth.logoutQuestion'))){
            Ipc.send('app', 'clearData')
        }
    }

    function clearData(){
        if(confirm(t('auth.clearDataQuestion'))){
            Ipc.send('app', 'clearData')
        }
    }

    return (
        <React.Fragment>
            <div id="component_auth">

                <div id="component_auth_modal">
                    { isLoading === true && userCode !== '' ?
                        <Card>
                            <div style={{ textAlign: 'center', paddingBottom: '20px' }}>
                                {/* Plain English on purpose: pairing happens before settings/i18n is loaded. */}
                                <h1>Enter this code to sign in</h1>
                                <p>Open the link below and enter the code shown here.</p>
                                <p style={{ fontFamily: 'monospace', fontSize: '32px', letterSpacing: '6px', userSelect: 'text' }}>
                                    { userCode }
                                </p>
                                <p style={{ userSelect: 'text' }}>{ verificationUri }</p>
                                <Button label='Open link' className='btn-primary' onClick={ () => {
                                    (window as any).Greenlight.openExternal(verificationUri)
                                } }></Button>
                            </div>
                        </Card>
                    : isLoading === false ?
                        <Card>
                            {signedIn === true ? (<div className="component_auth_profile_container">
                                <div className="component_auth_profile_gamerpic">
                                    <Image src={ gamerpic } className="component_auth_profile_gamerpic_img" alt={ gamertag } width='96' height='96'></Image>
                                </div>

                                <div className="component_auth_profile_userdetails">
                                    <h1>{ gamertag }</h1>
                                    <p>
                                        {t('auth.gamerscore')}: { gamerscore }
                                    </p>
                                    {/* <p>
                                        {t('auth.loggingIn')}
                                    </p> */}
                                    <Button label={t('auth.loginBtn')} className='btn-primary' onClick={ () => {
                                        startAuthFlow()
                                    } }></Button> &nbsp;
                                    <Button label={t('auth.logoutBtn')} className='btn' onClick={ () => {
                                        logout()
                                    } }></Button>
                                </div>

                            </div>) : (<div style={{
                                textAlign: 'center',
                                paddingBottom: '20px',
                            }}>
                                <h1>{t('auth.loginWithXbox')}</h1>
                                <p>
                                    {t('auth.pleaseAuthenticate')}
                                </p>
                                <Button label={t('auth.loginBtn')} className='btn-primary' onClick={ () => {
                                    startAuthFlow()
                                } }></Button> &nbsp;
                                <Button label={t('auth.clearDataBtn')} className='btn' onClick={ () => {
                                    clearData()
                                } }></Button>
                            </div>) }
                        </Card>:<Card><div style={{
                            textAlign: 'center',
                        }}><Loader></Loader><br /></div></Card>
                    }
                </div>
            </div>
        </React.Fragment>
    )
}

export default Auth
