import { createContext } from 'react'
export interface AuthUser { id:string;email:string;name:string;provider:string;demo:boolean }
export interface AuthContextValue { user:AuthUser|null;loading:boolean;configured:boolean;isAdmin:boolean;verificationStatus:'pending'|'approved'|'rejected';signInWithGoogle:()=>Promise<void>;signInWithPassword:(email:string,password:string,captchaToken?:string)=>Promise<void>;signUp:(name:string,email:string,password:string,captchaToken?:string)=>Promise<AuthUser>;signOut:()=>Promise<void>;startLocalDemo:(email:string)=>void;requestPasswordReset:(email:string,captchaToken?:string)=>Promise<void>;updatePassword:(password:string)=>Promise<void> }
export const AuthContext=createContext<AuthContextValue|null>(null)

